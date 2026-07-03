import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

import rag_eval.cli as cli
from rag_eval.generator.anthropic_client import ChunkContext
from rag_eval.generator.models import GeneratedQuestion
from tests.fakes import FakeConnection

runner = CliRunner()

PROFILE_ROW = ("chunks", "openai", "text-embedding-3-small", 1536, "recursive", {})


class ContextConnection(FakeConnection):
    """FakeConnection usable as a context manager like psycopg.connect(...)."""

    def __enter__(self) -> "ContextConnection":
        return self

    def __exit__(self, *args: object) -> None:
        return None


class FakeEmbedding:
    model = "text-embedding-3-small"
    dimensions = 1536

    def __init__(self) -> None:
        self.closed = False

    def embed_query(self, text: str) -> list[float]:
        return [0.1, 0.2]

    def close(self) -> None:
        self.closed = True


class FakeReranker:
    provider = "cohere"
    model = "rerank-v3.5"

    def __init__(self) -> None:
        self.closed = False

    def rerank(self, query: str, candidates: Any, top_n: int) -> list[tuple[str, float]]:
        return [(chunk_id, 0.9) for chunk_id, _ in candidates][:top_n]

    def close(self) -> None:
        self.closed = True


class FakeLlm:
    model = "claude-sonnet-5"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True

    async def generate_questions(
        self, chunk_content: str, context: ChunkContext, count: int
    ) -> list[GeneratedQuestion]:
        return [GeneratedQuestion(question=f"Q{i}", rationale="r") for i in range(count)]


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for name in ["RERANKER", "EVAL_K_VALUES", "RERANK_API_KEY", "ANTHROPIC_API_KEY"]:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("EMBEDDING_API_KEY", "embed-key")
    monkeypatch.setenv("EVAL_REPORTS_DIR", str(tmp_path / "reports"))


@pytest.fixture
def dataset(tmp_path: Path) -> Path:
    path = tmp_path / "golden.jsonl"
    case = {
        "queryId": "q_001",
        "query": "Wie geht das?",
        "relevantChunkIds": ["p1_0"],
        "source": "synthetic",
        "metadata": {},
    }
    path.write_text(json.dumps(case) + "\n", encoding="utf-8")
    return path


def install_connection(monkeypatch: pytest.MonkeyPatch, results: list[Any]) -> ContextConnection:
    conn = ContextConnection(results)
    monkeypatch.setattr(cli.psycopg, "connect", lambda *args, **kwargs: conn)
    return conn


class TestRunCommand:
    def test_runs_and_writes_reports(
        self, monkeypatch: pytest.MonkeyPatch, dataset: Path, tmp_path: Path
    ) -> None:
        install_connection(monkeypatch, [[PROFILE_ROW], [("p1_0", "content", 0.92)]])
        monkeypatch.setattr(cli, "create_embedding_client", lambda **kwargs: FakeEmbedding())

        result = runner.invoke(cli.app, ["run", "--dataset", str(dataset)])

        assert result.exit_code == 0, result.output
        reports = list((tmp_path / "reports").iterdir())
        assert {p.suffix for p in reports} == {".json", ".md"}
        report = json.loads(next(p for p in reports if p.suffix == ".json").read_text())
        assert report["aggregated"]["hitRate"] == 1
        assert report["config"]["profile"] == "default"

    def test_exits_with_code_2_for_missing_dataset(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        result = runner.invoke(cli.app, ["run", "--dataset", str(tmp_path / "missing.jsonl")])
        assert result.exit_code == 2

    def test_reranker_requires_api_key(
        self, monkeypatch: pytest.MonkeyPatch, dataset: Path
    ) -> None:
        install_connection(monkeypatch, [[PROFILE_ROW], [("p1_0", "content", 0.92)]])
        monkeypatch.setattr(cli, "create_embedding_client", lambda **kwargs: FakeEmbedding())

        result = runner.invoke(cli.app, ["run", "--dataset", str(dataset), "--reranker", "cohere"])

        assert result.exit_code == 1
        assert "RERANK_API_KEY" in result.output

    def test_run_with_reranker_reports_both_metric_sets(
        self, monkeypatch: pytest.MonkeyPatch, dataset: Path, tmp_path: Path
    ) -> None:
        monkeypatch.setenv("RERANK_API_KEY", "rerank-key")
        install_connection(monkeypatch, [[PROFILE_ROW], [("p1_0", "content", 0.92)]])
        monkeypatch.setattr(cli, "create_embedding_client", lambda **kwargs: FakeEmbedding())
        monkeypatch.setattr(cli, "create_reranker", lambda **kwargs: FakeReranker())

        result = runner.invoke(
            cli.app,
            [
                "run",
                "--dataset",
                str(dataset),
                "--reranker",
                "cohere",
                "--rerank-threshold",
                "0.35",
            ],
        )

        assert result.exit_code == 0, result.output
        json_report = next((tmp_path / "reports").glob("*_default_cohere.json"))
        report = json.loads(json_report.read_text())
        assert report["config"]["reranker"]["threshold"] == 0.35
        assert "rerankedAggregated" in report

    def test_closes_embedding_and_reranker_after_the_run(
        self, monkeypatch: pytest.MonkeyPatch, dataset: Path
    ) -> None:
        monkeypatch.setenv("RERANK_API_KEY", "rerank-key")
        install_connection(monkeypatch, [[PROFILE_ROW], [("p1_0", "content", 0.92)]])
        embedding = FakeEmbedding()
        reranker = FakeReranker()
        monkeypatch.setattr(cli, "create_embedding_client", lambda **kwargs: embedding)
        monkeypatch.setattr(cli, "create_reranker", lambda **kwargs: reranker)

        result = runner.invoke(cli.app, ["run", "--dataset", str(dataset), "--reranker", "cohere"])

        assert result.exit_code == 0, result.output
        assert embedding.closed
        assert reranker.closed

    def test_closes_embedding_even_when_the_run_fails(
        self, monkeypatch: pytest.MonkeyPatch, dataset: Path
    ) -> None:
        install_connection(monkeypatch, [[PROFILE_ROW], RuntimeError("db down")])
        embedding = FakeEmbedding()
        monkeypatch.setattr(cli, "create_embedding_client", lambda **kwargs: embedding)

        result = runner.invoke(cli.app, ["run", "--dataset", str(dataset)])

        assert result.exit_code != 0
        assert embedding.closed


class TestCompareCommand:
    def test_compares_multiple_profiles(
        self, monkeypatch: pytest.MonkeyPatch, dataset: Path, tmp_path: Path
    ) -> None:
        exp1_row = ("chunks_exp1", "openai", "text-embedding-3-large", 3072, "recursive", {})
        install_connection(
            monkeypatch,
            [
                [PROFILE_ROW],
                [("p1_0", "content", 0.92)],
                [exp1_row],
                [("x", "content", 0.8)],
            ],
        )
        monkeypatch.setattr(cli, "create_embedding_client", lambda **kwargs: FakeEmbedding())

        result = runner.invoke(
            cli.app,
            ["compare", "--dataset", str(dataset), "--profile", "default", "--profile", "exp1"],
        )

        assert result.exit_code == 0, result.output
        comparison = next((tmp_path / "reports").glob("comparison_*.md"))
        content = comparison.read_text(encoding="utf-8")
        assert "| default |" in content
        assert "| exp1 |" in content
        # default finds the relevant chunk, exp1 does not → default wins hit-rate
        assert "**1.0000**" in content


class TestGenerateCommand:
    def test_requires_anthropic_api_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        result = runner.invoke(cli.app, ["generate"])
        assert result.exit_code == 1
        assert "ANTHROPIC_API_KEY" in result.output

    def test_generates_a_dataset(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-key")
        sample_row = (
            "p1_0",
            "p1",
            "DOCS",
            "Page p1",
            "content p1/0",
            {"headerPath": [], "chunkIndex": 0, "totalChunks": 1},
        )
        install_connection(
            monkeypatch,
            [
                [PROFILE_ROW],  # load_profile
                [],  # setseed
                [sample_row],  # sample_chunks
                [sample_row],  # get_chunks_by_page_id
            ],
        )
        monkeypatch.setattr(cli, "AnthropicClient", lambda api_key: FakeLlm(api_key))
        out = tmp_path / "golden.jsonl"

        result = runner.invoke(
            cli.app,
            [
                "generate",
                "--num-chunks",
                "1",
                "--questions-per-chunk",
                "2",
                "--seed",
                "7",
                "--out",
                str(out),
            ],
        )

        assert result.exit_code == 0, result.output
        lines = [line for line in out.read_text(encoding="utf-8").split("\n") if line]
        assert len(lines) == 2
        assert json.loads(lines[0])["queryId"] == "q_001"
