from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from rag_eval.runner.report import report_timestamp


@dataclass(frozen=True)
class ComparisonRow:
    """One evaluated configuration and its effective aggregated metrics.

    For reranked configurations ``aggregated`` holds the POST-rerank numbers —
    the comparison answers "which end-to-end retrieval setup is better".
    """

    label: str
    aggregated: dict[str, Any]


def build_comparison_table(rows: Sequence[ComparisonRow], k_values: Sequence[int]) -> str:
    """Render a Markdown metrics table; the best value per column is bolded."""
    columns = _column_spec(k_values)
    header = "| config | " + " | ".join(name for name, _ in columns) + " |"
    separator = "|---" * (len(columns) + 1) + "|"

    values = [[extract(row.aggregated) for _, extract in columns] for row in rows]
    winners = [_column_max(values, index) for index in range(len(columns))]

    body = [
        "| "
        + row.label
        + " | "
        + " | ".join(
            _fmt_cell(values[row_index][col_index], winners[col_index])
            for col_index in range(len(columns))
        )
        + " |"
        for row_index, row in enumerate(rows)
    ]
    return "\n".join([header, separator, *body])


def render_comparison_markdown(
    rows: Sequence[ComparisonRow],
    k_values: Sequence[int],
    dataset_path: str,
    generated_at: str,
) -> str:
    return "\n".join(
        [
            "# RAG Profile Comparison",
            "",
            f"- Generated: {generated_at}",
            f"- Dataset: `{dataset_path}`",
            f"- Configurations: {len(rows)}",
            "",
            "Best value per metric is **bold**. Reranked configurations show post-rerank metrics.",
            "",
            build_comparison_table(rows, k_values),
            "",
        ]
    )


def write_comparison(
    rows: Sequence[ComparisonRow],
    k_values: Sequence[int],
    reports_dir: str | Path,
    dataset_path: str,
    generated_at: str,
    *,
    timestamp: str | None = None,
) -> Path:
    directory = Path(reports_dir).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"comparison_{timestamp or report_timestamp()}.md"
    path.write_text(
        render_comparison_markdown(rows, k_values, dataset_path, generated_at), encoding="utf-8"
    )
    return path


def _column_spec(k_values: Sequence[int]) -> list[tuple[str, Any]]:
    def at_k(metric: str, k: int) -> Any:
        return lambda aggregated: aggregated[metric].get(str(k))

    columns: list[tuple[str, Any]] = []
    columns += [(f"precision@{k}", at_k("precisionAtK", k)) for k in k_values]
    columns += [(f"recall@{k}", at_k("recallAtK", k)) for k in k_values]
    columns += [(f"nDCG@{k}", at_k("ndcgAtK", k)) for k in k_values]
    columns.append(("MRR", lambda aggregated: aggregated["mrr"]))
    columns.append(("hit-rate", lambda aggregated: aggregated["hitRate"]))
    return columns


def _column_max(values: Sequence[Sequence[float | None]], index: int) -> float | None:
    present = [row[index] for row in values if row[index] is not None]
    return max(present) if present else None


def _fmt_cell(value: float | None, winner: float | None) -> str:
    if value is None:
        return "—"
    formatted = f"{value:.4f}"
    if winner is not None and value == winner:
        return f"**{formatted}**"
    return formatted
