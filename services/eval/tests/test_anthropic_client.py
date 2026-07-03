import json

import pytest
from pytest_httpx import HTTPXMock

from rag_eval.generator.anthropic_client import (
    AnthropicClient,
    ChunkContext,
    build_user_prompt,
    parse_json_lenient,
    parse_question_json,
    parse_questions_json,
)


class TestParseJsonLenient:
    def test_parses_plain_json(self) -> None:
        assert parse_json_lenient('{"a":1}') == {"a": 1}

    def test_strips_json_fences(self) -> None:
        assert parse_json_lenient('```json\n{"a":1}\n```') == {"a": 1}

    def test_strips_bare_fences(self) -> None:
        assert parse_json_lenient('```\n{"a":1}\n```') == {"a": 1}

    def test_extracts_the_first_object_when_surrounded_by_prose(self) -> None:
        raw = 'Sure! Here is your JSON: {"a":1} hope that helps.'
        assert parse_json_lenient(raw) == {"a": 1}

    def test_throws_if_no_json_object_is_present(self) -> None:
        with pytest.raises(ValueError):
            parse_json_lenient("nothing here")


class TestParseQuestionJson:
    def test_parses_a_well_formed_response(self) -> None:
        result = parse_question_json('{"question":"Wie?", "rationale":"weil"}')
        assert result.question == "Wie?"
        assert result.rationale == "weil"

    def test_tolerates_fenced_output(self) -> None:
        result = parse_question_json('```json\n{"question":"Wie?","rationale":"weil"}\n```')
        assert result.question == "Wie?"

    def test_trims_whitespace_from_fields(self) -> None:
        result = parse_question_json('{"question":"  Wie?  ","rationale":"  weil  "}')
        assert result.question == "Wie?"
        assert result.rationale == "weil"

    def test_rejects_missing_question(self) -> None:
        with pytest.raises(ValueError, match="question"):
            parse_question_json('{"rationale":"weil"}')

    def test_rejects_empty_question(self) -> None:
        with pytest.raises(ValueError, match="question"):
            parse_question_json('{"question":"   ","rationale":"weil"}')

    def test_rejects_missing_rationale(self) -> None:
        with pytest.raises(ValueError, match="rationale"):
            parse_question_json('{"question":"Wie?"}')


class TestParseQuestionsJson:
    def test_parses_a_questions_array(self) -> None:
        raw = json.dumps(
            {
                "questions": [
                    {"question": "Wie A?", "rationale": "weil A"},
                    {"question": "Wie B?", "rationale": "weil B"},
                ]
            }
        )
        result = parse_questions_json(raw)
        assert [q.question for q in result] == ["Wie A?", "Wie B?"]

    def test_accepts_a_bare_single_object(self) -> None:
        result = parse_questions_json('{"question":"Wie?","rationale":"weil"}')
        assert len(result) == 1
        assert result[0].question == "Wie?"

    def test_truncates_surplus_questions_to_expected_count(self) -> None:
        raw = json.dumps(
            {
                "questions": [
                    {"question": "A?", "rationale": "a"},
                    {"question": "B?", "rationale": "b"},
                    {"question": "C?", "rationale": "c"},
                ]
            }
        )
        result = parse_questions_json(raw, expected_count=2)
        assert [q.question for q in result] == ["A?", "B?"]

    def test_rejects_empty_questions_array(self) -> None:
        with pytest.raises(ValueError, match="non-empty"):
            parse_questions_json('{"questions": []}')

    def test_rejects_invalid_entry_in_array(self) -> None:
        with pytest.raises(ValueError, match="question"):
            parse_questions_json('{"questions": [{"rationale": "weil"}]}')


class TestBuildUserPrompt:
    def test_includes_title_header_path_count_and_content(self) -> None:
        prompt = build_user_prompt(
            "chunk body", ChunkContext(title="Setup", header_path=("A", "B")), 2
        )
        assert "Erzeuge genau 2 Frage(n)." in prompt
        assert "Chunk-Titel: Setup" in prompt
        assert "Header-Pfad: A > B" in prompt
        assert "chunk body" in prompt

    def test_renders_placeholder_for_empty_header_path(self) -> None:
        prompt = build_user_prompt("body", ChunkContext(title="Setup", header_path=()), 1)
        assert "Header-Pfad: (keine)" in prompt


class TestGenerateQuestions:
    async def test_generates_questions_via_the_messages_api(self, httpx_mock: HTTPXMock) -> None:
        payload = {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "questions": [
                                {"question": "Wie A?", "rationale": "weil A"},
                                {"question": "Wie B?", "rationale": "weil B"},
                            ]
                        }
                    ),
                }
            ]
        }
        httpx_mock.add_response(
            url="https://api.anthropic.com/v1/messages", method="POST", json=payload
        )

        client = AnthropicClient(api_key="test-key")
        questions = await client.generate_questions(
            "chunk content", ChunkContext(title="Setup", header_path=("Section",)), 2
        )

        assert [q.question for q in questions] == ["Wie A?", "Wie B?"]
        request = httpx_mock.get_request()
        assert request is not None
        assert request.headers["x-api-key"] == "test-key"
        assert request.headers["anthropic-version"] == "2023-06-01"
        body = json.loads(request.content)
        assert body["model"] == "claude-sonnet-5"
        assert body["system"][0]["cache_control"] == {"type": "ephemeral"}
        assert "Erzeuge genau 2 Frage(n)." in body["messages"][0]["content"]

    async def test_raises_on_response_without_text_blocks(self, httpx_mock: HTTPXMock) -> None:
        httpx_mock.add_response(
            url="https://api.anthropic.com/v1/messages", method="POST", json={"content": []}
        )

        client = AnthropicClient(api_key="test-key")
        with pytest.raises(ValueError, match="no text blocks"):
            await client.generate_questions("c", ChunkContext(title="T", header_path=()), 1)

    async def test_rejects_non_positive_count(self) -> None:
        client = AnthropicClient(api_key="test-key")
        with pytest.raises(ValueError, match="count"):
            await client.generate_questions("c", ChunkContext(title="T", header_path=()), 0)
