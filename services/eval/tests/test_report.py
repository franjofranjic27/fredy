import json
from pathlib import Path
from typing import Any

from rag_eval.runner.report import format_summary, render_markdown_summary, write_report


def sample_report(with_reranker: bool = False) -> dict[str, Any]:
    report: dict[str, Any] = {
        "generatedAt": "2026-07-03T10:15:00+00:00",
        "config": {
            "profile": "default",
            "vectorTable": "chunks",
            "embeddingProvider": "openai",
            "embeddingModel": "text-embedding-3-small",
            "searchLimit": 20,
            "scoreThreshold": 0.0,
            "kValues": [1, 3],
            "reranker": None,
        },
        "dataset": {"path": "data/golden.jsonl", "queryCount": 2},
        "aggregated": {
            "precisionAtK": {"1": 0.5, "3": 0.3333},
            "recallAtK": {"1": 0.25, "3": 0.75},
            "ndcgAtK": {"1": 0.5, "3": 0.61},
            "hitRate": 0.5,
            "mrr": 0.5,
        },
        "perQuery": [],
    }
    if with_reranker:
        report["config"]["reranker"] = {
            "provider": "cohere",
            "model": "rerank-v3.5",
            "topN": 10,
            "threshold": 0.35,
        }
        report["rerankedAggregated"] = {
            "precisionAtK": {"1": 1.0, "3": 0.6667},
            "recallAtK": {"1": 0.5, "3": 1.0},
            "ndcgAtK": {"1": 1.0, "3": 0.9},
            "hitRate": 1.0,
            "mrr": 1.0,
        }
    return report


class TestWriteReport:
    def test_writes_json_and_markdown_with_profile_in_filename(self, tmp_path: Path) -> None:
        json_path, markdown_path = write_report(
            sample_report(), tmp_path, timestamp="20260703T101500Z"
        )

        assert json_path.name == "20260703T101500Z_default.json"
        assert markdown_path.name == "20260703T101500Z_default.md"
        assert json.loads(json_path.read_text(encoding="utf-8")) == sample_report()

    def test_appends_reranker_provider_to_the_filename(self, tmp_path: Path) -> None:
        json_path, _ = write_report(
            sample_report(with_reranker=True), tmp_path, timestamp="20260703T101500Z"
        )
        assert json_path.name == "20260703T101500Z_default_cohere.json"

    def test_creates_the_reports_directory(self, tmp_path: Path) -> None:
        target = tmp_path / "nested" / "reports"
        json_path, _ = write_report(sample_report(), target)
        assert json_path.parent == target.resolve()


class TestRenderMarkdownSummary:
    def test_contains_config_and_metric_table(self) -> None:
        markdown = render_markdown_summary(sample_report())

        assert "profile `default`" in markdown
        assert "| k | Precision@k | Recall@k | nDCG@k |" in markdown
        assert "| 1 | 0.5000 | 0.2500 | 0.5000 |" in markdown
        assert "- MRR: 0.5000" in markdown
        assert "post-rerank" not in markdown

    def test_includes_post_rerank_section_when_reranked(self) -> None:
        markdown = render_markdown_summary(sample_report(with_reranker=True))

        assert "Reranker: cohere / rerank-v3.5 (topN=10, threshold=0.35)" in markdown
        assert "## Aggregated metrics (pre-rerank)" in markdown
        assert "## Aggregated metrics (post-rerank)" in markdown
        assert "| 1 | 1.0000 | 0.5000 | 1.0000 |" in markdown


class TestFormatSummary:
    def test_renders_console_summary(self) -> None:
        summary = format_summary(sample_report())

        assert "RAG Eval — Retrieval Quality Report" in summary
        assert "Dataset:          data/golden.jsonl (2 queries)" in summary
        assert "Embedding:        openai / text-embedding-3-small" in summary
        assert "HitRate:          0.5000" in summary
        assert "MRR:              0.5000" in summary

    def test_includes_reranker_line_and_post_rerank_table_when_active(self) -> None:
        summary = format_summary(sample_report(with_reranker=True))

        assert "Reranker:         cohere / rerank-v3.5" in summary
        assert "Aggregated metrics (post-rerank):" in summary
