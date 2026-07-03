import json
from pathlib import Path

import pytest

from rag_eval.dataset.loader import DatasetNotFoundError, DatasetParseError, load_dataset


def valid_case(query_id: str = "q_001") -> dict:
    return {
        "queryId": query_id,
        "query": "Wie konfiguriere ich den Confluence-Import?",
        "relevantChunkIds": ["12345_0", "12345_1"],
        "source": "synthetic",
        "metadata": {"sourcePageId": "12345"},
    }


def write_jsonl(path: Path, entries: list[dict | str]) -> Path:
    lines = [entry if isinstance(entry, str) else json.dumps(entry) for entry in entries]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_loads_valid_cases(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "golden.jsonl", [valid_case("q_001"), valid_case("q_002")])

    cases = load_dataset(path)

    assert len(cases) == 2
    assert cases[0].query_id == "q_001"
    assert cases[0].relevant_chunk_ids == ["12345_0", "12345_1"]
    assert cases[1].query_id == "q_002"


def test_skips_blank_lines(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "golden.jsonl", [valid_case(), "", "   "])

    cases = load_dataset(path)

    assert len(cases) == 1


def test_tolerates_extra_fields(tmp_path: Path) -> None:
    case = valid_case() | {"extraField": "kept"}
    path = write_jsonl(tmp_path / "golden.jsonl", [case])

    cases = load_dataset(path)

    assert cases[0].query_id == "q_001"


def test_metadata_defaults_to_empty_dict(tmp_path: Path) -> None:
    case = valid_case()
    del case["metadata"]
    path = write_jsonl(tmp_path / "golden.jsonl", [case])

    cases = load_dataset(path)

    assert cases[0].metadata == {}


def test_raises_not_found_for_missing_file(tmp_path: Path) -> None:
    with pytest.raises(DatasetNotFoundError):
        load_dataset(tmp_path / "missing.jsonl")


def test_raises_parse_error_with_line_number_for_malformed_json(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "golden.jsonl", [valid_case(), "not json"])

    with pytest.raises(DatasetParseError) as excinfo:
        load_dataset(path)

    assert excinfo.value.line_number == 2
    assert "Malformed JSON" in excinfo.value.reason


def test_rejects_missing_query_id(tmp_path: Path) -> None:
    case = valid_case()
    del case["queryId"]
    path = write_jsonl(tmp_path / "golden.jsonl", [case])

    with pytest.raises(DatasetParseError) as excinfo:
        load_dataset(path)

    assert "queryId" in str(excinfo.value)


def test_rejects_empty_query(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "golden.jsonl", [valid_case() | {"query": ""}])

    with pytest.raises(DatasetParseError):
        load_dataset(path)


def test_rejects_empty_relevant_chunk_ids(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "golden.jsonl", [valid_case() | {"relevantChunkIds": []}])

    with pytest.raises(DatasetParseError):
        load_dataset(path)


def test_rejects_empty_string_in_relevant_chunk_ids(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "golden.jsonl", [valid_case() | {"relevantChunkIds": [""]}])

    with pytest.raises(DatasetParseError):
        load_dataset(path)


def test_rejects_duplicate_query_ids(tmp_path: Path) -> None:
    path = write_jsonl(tmp_path / "golden.jsonl", [valid_case("q_001"), valid_case("q_001")])

    with pytest.raises(DatasetParseError) as excinfo:
        load_dataset(path)

    assert 'Duplicate queryId "q_001"' in excinfo.value.reason


def test_rejects_empty_dataset(tmp_path: Path) -> None:
    path = tmp_path / "golden.jsonl"
    path.write_text("\n\n", encoding="utf-8")

    with pytest.raises(DatasetParseError) as excinfo:
        load_dataset(path)

    assert "Dataset is empty" in excinfo.value.reason
