import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedQuestion } from "./types.js";

export const QUESTION_GENERATOR_MODEL = "claude-opus-4-7";

export interface AnthropicClientConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxTokens?: number;
}

export interface ChunkContext {
  readonly title: string;
  readonly headerPath: readonly string[];
}

/**
 * Static portion of the prompt. Kept large enough to clear Anthropic's
 * cache-eligibility threshold and worth a `cache_control` marker — the same
 * system prompt is reused for every chunk in a run.
 */
const SYSTEM_PROMPT = `Du bist ein erfahrener Tester für IT-Ops-Wissensdatenbanken. Deine Aufgabe ist es, ein synthetisches Eval-Dataset für ein RAG-Retrieval-System zu erzeugen.

Erzeuge zu einem gegebenen Wissensdatenbank-Chunk EINE realistische Nutzer-Frage, die ein IT-Mitarbeiter im Arbeitsalltag stellen würde und die DIREKT durch genau diesen Chunk beantwortet wird.

Anforderungen an die Frage:
- Eigenständig verständlich, keine Pronomen ohne Antezedens ("Wie konfiguriere ich es?" ist verboten — "Wie konfiguriere ich den Confluence-Import?" ist gut).
- Spezifisch genug, um gezielte Suche zu ermöglichen, aber nicht so spezifisch, dass sie das Wording des Chunks 1:1 kopiert.
- Auf Deutsch formuliert, im Stil einer echten Frage in einem internen Ticket- oder Chat-System.
- Ein einzelner Satz. Keine zusammengesetzten Fragen mit "und".
- Keine Meta-Fragen ("Was steht in diesem Chunk?") und keine Trivialfragen ohne Informationswert.

Zusätzlich gibst du eine kurze Rationale (1 Satz), die erklärt, warum genau dieser Chunk die Frage beantwortet.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt der Form:
{"question": "<die Frage>", "rationale": "<kurze Begründung>"}

Kein Markdown-Codefence, keine Erklärung davor oder danach.`;

export class AnthropicClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: AnthropicClientConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? QUESTION_GENERATOR_MODEL;
    this.maxTokens = config.maxTokens ?? 512;
  }

  get modelName(): string {
    return this.model;
  }

  async generateQuestion(
    chunkContent: string,
    chunkContext: ChunkContext,
  ): Promise<GeneratedQuestion> {
    const userContent = buildUserPrompt(chunkContent, chunkContext);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
    });

    const text = extractText(response);
    return parseQuestionJson(text);
  }

  /**
   * Verify that a candidate chunk actually answers the generated question.
   * Used to filter same-page neighbour chunks before adding them to
   * `relevantChunkIds`. Returns false if the model says no or if the answer
   * is unparseable — false negatives are preferable to false positives in an
   * eval set.
   */
  async verifyRelevance(question: string, candidateContent: string): Promise<boolean> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 64,
      system: [
        {
          type: "text",
          text:
            "Du bist ein Relevanz-Bewerter für RAG-Evals. Antworte ausschließlich mit JSON " +
            '{"relevant": true|false}. Beantworte true nur, wenn der Chunk substanzielle ' +
            "Information enthält, die zur Beantwortung der Frage beiträgt.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Frage: ${question}\n\nChunk:\n${candidateContent}`,
        },
      ],
    });

    try {
      const text = extractText(response);
      const json = parseJsonLenient(text) as { relevant?: unknown };
      return json.relevant === true;
    } catch {
      return false;
    }
  }
}

function buildUserPrompt(content: string, context: ChunkContext): string {
  const headerPath = context.headerPath.length > 0 ? context.headerPath.join(" > ") : "(keine)";
  return `Chunk-Titel: ${context.title}\nHeader-Pfad: ${headerPath}\nChunk-Inhalt:\n${content}`;
}

function extractText(response: Anthropic.Messages.Message): string {
  const parts = response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text);
  if (parts.length === 0) {
    throw new Error("Anthropic response contained no text blocks");
  }
  return parts.join("\n").trim();
}

export function parseQuestionJson(raw: string): GeneratedQuestion {
  const parsed = parseJsonLenient(raw) as { question?: unknown; rationale?: unknown };
  if (typeof parsed.question !== "string" || parsed.question.trim().length === 0) {
    throw new Error(`LLM response missing 'question' field: ${raw}`);
  }
  if (typeof parsed.rationale !== "string") {
    throw new Error(`LLM response missing 'rationale' field: ${raw}`);
  }
  return {
    question: parsed.question.trim(),
    rationale: parsed.rationale.trim(),
  };
}

/**
 * Strip optional Markdown fences before JSON.parse — even with a strict system
 * prompt the model occasionally wraps responses in ```json ... ```.
 */
export function parseJsonLenient(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const objectMatch = candidate.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      throw new Error(`Could not parse JSON from LLM response: ${raw}`);
    }
    return JSON.parse(objectMatch[0]);
  }
}
