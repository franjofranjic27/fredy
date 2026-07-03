from pathlib import Path
from typing import Any

from rag_eval.compare import (
    ComparisonRow,
    build_comparison_table,
    render_comparison_markdown,
    write_comparison,
)


def aggregated(precision_1: float, mrr: float, hit_rate: float) -> dict[str, Any]:
    return {
        "precisionAtK": {"1": precision_1},
        "recallAtK": {"1": 0.5},
        "ndcgAtK": {"1": precision_1},
        "hitRate": hit_rate,
        "mrr": mrr,
    }


ROWS = [
    ComparisonRow(label="default", aggregated=aggregated(0.5, 0.6, 0.9)),
    ComparisonRow(label="exp1 + cohere", aggregated=aggregated(0.8, 0.4, 0.9)),
]


class TestBuildComparisonTable:
    def test_renders_one_row_per_config_with_metric_columns(self) -> None:
        table = build_comparison_table(ROWS, [1])
        lines = table.split("\n")

        assert lines[0] == "| config | precision@1 | recall@1 | nDCG@1 | MRR | hit-rate |"
        assert len(lines) == 4  # header + separator + 2 rows
        assert lines[2].startswith("| default |")
        assert lines[3].startswith("| exp1 + cohere |")

    def test_bolds_the_winner_per_column(self) -> None:
        table = build_comparison_table(ROWS, [1])
        lines = table.split("\n")

        # exp1 wins precision@1 and nDCG@1; default wins MRR
        default_cells = [cell.strip() for cell in lines[2].split("|")]
        exp1_cells = [cell.strip() for cell in lines[3].split("|")]
        assert exp1_cells[2] == "**0.8000**"  # precision@1 winner
        assert default_cells[2] == "0.5000"  # loser stays plain
        assert default_cells[5] == "**0.6000**"  # MRR winner
        assert exp1_cells[5] == "0.4000"

    def test_bolds_all_rows_on_a_tie(self) -> None:
        table = build_comparison_table(ROWS, [1])
        lines = table.split("\n")

        # hit-rate is tied at 0.9 — both bolded
        assert lines[2].count("**0.9000**") == 1
        assert lines[3].count("**0.9000**") == 1

    def test_renders_dash_for_missing_k_values(self) -> None:
        rows = [ComparisonRow(label="default", aggregated=aggregated(0.5, 0.6, 0.9))]
        table = build_comparison_table(rows, [1, 5])
        assert "—" in table


class TestRenderComparisonMarkdown:
    def test_contains_header_and_table(self) -> None:
        markdown = render_comparison_markdown(
            ROWS, [1], "data/golden.jsonl", "2026-07-03T10:15:00+00:00"
        )
        assert "# RAG Profile Comparison" in markdown
        assert "Dataset: `data/golden.jsonl`" in markdown
        assert "Configurations: 2" in markdown
        assert "| config |" in markdown


class TestWriteComparison:
    def test_writes_the_comparison_file(self, tmp_path: Path) -> None:
        path = write_comparison(
            ROWS,
            [1],
            tmp_path,
            "data/golden.jsonl",
            "2026-07-03T10:15:00+00:00",
            timestamp="20260703T101500Z",
        )
        assert path.name == "comparison_20260703T101500Z.md"
        content = path.read_text(encoding="utf-8")
        assert "| default |" in content
        assert "| exp1 + cohere |" in content
