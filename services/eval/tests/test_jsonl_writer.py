import json
from pathlib import Path

from rag_eval.generator.jsonl_writer import write_jsonl
from rag_eval.generator.models import GoldenRecord


def make_record(query_id: str) -> GoldenRecord:
    return GoldenRecord(
        query_id=query_id,
        query=f"Frage {query_id}",
        relevant_chunk_ids=(f"{query_id}_0",),
        source="synthetic",
        metadata={
            "sourcePageId": query_id,
            "sourcePageTitle": f"Title {query_id}",
            "sourceSpaceKey": "DOCS",
            "generatedBy": "claude-sonnet-5",
            "generatedAt": "2026-07-03T12:00:00Z",
        },
    )


def test_writes_one_record_per_line(tmp_path: Path) -> None:
    path = tmp_path / "out.jsonl"
    write_jsonl(path, [make_record("q_001"), make_record("q_002")])

    lines = [line for line in path.read_text(encoding="utf-8").split("\n") if line]
    assert len(lines) == 2
    assert json.loads(lines[0])["queryId"] == "q_001"
    assert json.loads(lines[1])["queryId"] == "q_002"


def test_serializes_camel_case_wire_format(tmp_path: Path) -> None:
    path = tmp_path / "out.jsonl"
    write_jsonl(path, [make_record("q_001")])

    record = json.loads(path.read_text(encoding="utf-8").strip())
    assert set(record) == {"queryId", "query", "relevantChunkIds", "source", "metadata"}
    assert record["relevantChunkIds"] == ["q_001_0"]


def test_creates_nested_output_directories(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "deep" / "out.jsonl"
    write_jsonl(path, [make_record("q_001")])
    assert "q_001" in path.read_text(encoding="utf-8")


def test_writes_an_empty_file_for_an_empty_record_list(tmp_path: Path) -> None:
    path = tmp_path / "empty.jsonl"
    write_jsonl(path, [])
    assert path.read_text(encoding="utf-8") == ""


def test_overwrites_an_existing_file_atomically(tmp_path: Path) -> None:
    path = tmp_path / "out.jsonl"
    path.write_text("stale content", encoding="utf-8")
    write_jsonl(path, [make_record("q_001")])

    content = path.read_text(encoding="utf-8")
    assert "stale" not in content
    assert "q_001" in content


def test_leaves_no_leftover_tmp_files_after_a_successful_write(tmp_path: Path) -> None:
    path = tmp_path / "out.jsonl"
    write_jsonl(path, [make_record("q_001")])

    leftovers = [entry.name for entry in tmp_path.iterdir() if ".tmp-" in entry.name]
    assert leftovers == []
