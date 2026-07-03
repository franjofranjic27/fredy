import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from rag_eval.generator.models import GeneratedQuestion
from rag_eval.http_retry import async_post_with_retry

QUESTION_GENERATOR_MODEL = "claude-sonnet-5"
ANTHROPIC_VERSION = "2023-06-01"

# The prompt is intentionally German: the knowledge base and the production
# user queries are German, and the golden questions must match that
# distribution. Kept semantically identical to the TypeScript version,
# extended to produce N questions per chunk in one call.
SYSTEM_PROMPT = """Du bist ein erfahrener Tester für IT-Ops-Wissensdatenbanken. Deine Aufgabe ist \
es, ein synthetisches Eval-Dataset für ein RAG-Retrieval-System zu erzeugen.

Erzeuge zu einem gegebenen Wissensdatenbank-Chunk die geforderte Anzahl realistischer \
Nutzer-Fragen, die ein IT-Mitarbeiter im Arbeitsalltag stellen würde und die DIREKT durch genau \
diesen Chunk beantwortet werden.

Anforderungen an jede Frage:
- Eigenständig verständlich, keine Pronomen ohne Antezedens ("Wie konfiguriere ich es?" ist \
verboten — "Wie konfiguriere ich den Confluence-Import?" ist gut).
- Spezifisch genug, um gezielte Suche zu ermöglichen, aber nicht so spezifisch, dass sie das \
Wording des Chunks 1:1 kopiert.
- Auf Deutsch formuliert, im Stil einer echten Frage in einem internen Ticket- oder Chat-System.
- Ein einzelner Satz. Keine zusammengesetzten Fragen mit "und".
- Keine Meta-Fragen ("Was steht in diesem Chunk?") und keine Trivialfragen ohne Informationswert.
- Die Fragen unterscheiden sich inhaltlich voneinander und decken verschiedene Aspekte des \
Chunks ab.

Zusätzlich gibst du zu jeder Frage eine kurze Rationale (1 Satz), die erklärt, warum genau \
dieser Chunk die Frage beantwortet.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt der Form:
{"questions": [{"question": "<die Frage>", "rationale": "<kurze Begründung>"}]}

Kein Markdown-Codefence, keine Erklärung davor oder danach."""

FENCE_PATTERN = re.compile(r"^```(?:json)?\s*([\s\S]*?)\s*```$", re.IGNORECASE)
OBJECT_PATTERN = re.compile(r"\{[\s\S]*\}")


@dataclass(frozen=True)
class ChunkContext:
    title: str
    header_path: tuple[str, ...]


class AnthropicClient:
    """Generates golden questions per chunk via the Anthropic Messages API.

    The system prompt carries a ``cache_control`` marker: it is identical for
    every chunk in a run, so prompt caching cuts the cost of large runs.
    """

    def __init__(
        self,
        api_key: str,
        model: str = QUESTION_GENERATOR_MODEL,
        max_tokens: int = 2048,
        base_url: str = "https://api.anthropic.com",
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self.model = model
        self._max_tokens = max_tokens
        self._base_url = base_url
        self._client = client or httpx.AsyncClient(timeout=60.0)

    async def aclose(self) -> None:
        """Release the underlying HTTP connection pool."""
        await self._client.aclose()

    async def generate_questions(
        self, chunk_content: str, context: ChunkContext, count: int
    ) -> list[GeneratedQuestion]:
        if count <= 0:
            raise ValueError(f"count must be positive, got {count}")

        data = await async_post_with_retry(
            self._client,
            f"{self._base_url}/v1/messages",
            service="Anthropic",
            json={
                "model": self.model,
                "max_tokens": self._max_tokens,
                "system": [
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                "messages": [
                    {"role": "user", "content": build_user_prompt(chunk_content, context, count)}
                ],
            },
            headers={
                "x-api-key": self._api_key,
                "anthropic-version": ANTHROPIC_VERSION,
            },
        )
        text = extract_text(data)
        return parse_questions_json(text, expected_count=count)


def build_user_prompt(content: str, context: ChunkContext, count: int) -> str:
    header_path = " > ".join(context.header_path) if context.header_path else "(keine)"
    return (
        f"Erzeuge genau {count} Frage(n).\n"
        f"Chunk-Titel: {context.title}\n"
        f"Header-Pfad: {header_path}\n"
        f"Chunk-Inhalt:\n{content}"
    )


def extract_text(response: dict[str, Any]) -> str:
    blocks = response.get("content", [])
    parts = [block["text"] for block in blocks if block.get("type") == "text"]
    if not parts:
        raise ValueError("Anthropic response contained no text blocks")
    return "\n".join(parts).strip()


def parse_question_json(raw: str) -> GeneratedQuestion:
    """Parse a single ``{"question": ..., "rationale": ...}`` object."""
    parsed = parse_json_lenient(raw)
    return _validate_question_object(parsed, raw)


def parse_questions_json(raw: str, expected_count: int | None = None) -> list[GeneratedQuestion]:
    """Parse a ``{"questions": [...]}`` response; tolerates a bare single object.

    If the model returns more questions than requested the surplus is
    truncated; fewer questions are accepted as long as there is at least one.
    """
    parsed = parse_json_lenient(raw)
    if not isinstance(parsed, dict):
        raise ValueError(f"LLM response is not a JSON object: {raw}")

    if "questions" in parsed:
        items = parsed["questions"]
        if not isinstance(items, list) or not items:
            raise ValueError(f"LLM response 'questions' must be a non-empty array: {raw}")
        questions = [_validate_question_object(item, raw) for item in items]
    else:
        questions = [_validate_question_object(parsed, raw)]

    if expected_count is not None:
        return questions[:expected_count]
    return questions


def _validate_question_object(parsed: Any, raw: str) -> GeneratedQuestion:
    if not isinstance(parsed, dict):
        raise ValueError(f"LLM question entry is not a JSON object: {raw}")
    question = parsed.get("question")
    rationale = parsed.get("rationale")
    if not isinstance(question, str) or not question.strip():
        raise ValueError(f"LLM response missing 'question' field: {raw}")
    if not isinstance(rationale, str):
        raise ValueError(f"LLM response missing 'rationale' field: {raw}")
    return GeneratedQuestion(question=question.strip(), rationale=rationale.strip())


def parse_json_lenient(raw: str) -> Any:
    """Strip optional Markdown fences before parsing.

    Even with a strict system prompt the model occasionally wraps responses in
    ```json ... ``` or surrounds the object with prose.
    """
    trimmed = raw.strip()
    fenced = FENCE_PATTERN.match(trimmed)
    candidate = fenced.group(1).strip() if fenced else trimmed
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        object_match = OBJECT_PATTERN.search(candidate)
        if not object_match:
            raise ValueError(f"Could not parse JSON from LLM response: {raw}") from None
        return json.loads(object_match.group(0))
