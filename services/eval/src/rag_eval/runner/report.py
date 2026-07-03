import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def report_timestamp(now: datetime | None = None) -> str:
    """Filesystem-safe compact UTC timestamp for report filenames."""
    moment = now or datetime.now(UTC)
    return moment.strftime("%Y%m%dT%H%M%SZ")


def write_report(
    report: dict[str, Any],
    reports_dir: str | Path,
    *,
    timestamp: str | None = None,
) -> tuple[Path, Path]:
    """Write the JSON report plus a Markdown summary; returns both paths.

    Filename: ``<timestamp>_<profile>[_<reranker>].json``
    """
    directory = Path(reports_dir).resolve()
    directory.mkdir(parents=True, exist_ok=True)

    profile = report["config"]["profile"]
    reranker = report["config"].get("reranker")
    stem = f"{timestamp or report_timestamp()}_{profile}"
    if reranker is not None:
        stem += f"_{reranker['provider']}"

    json_path = directory / f"{stem}.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    markdown_path = directory / f"{stem}.md"
    markdown_path.write_text(render_markdown_summary(report), encoding="utf-8")

    return json_path, markdown_path


def render_markdown_summary(report: dict[str, Any]) -> str:
    config = report["config"]
    dataset = report["dataset"]
    lines = [
        f"# Eval Report — profile `{config['profile']}`",
        "",
        f"- Generated: {report['generatedAt']}",
        f"- Dataset: `{dataset['path']}` ({dataset['queryCount']} queries)",
        f"- Vector table: `{config['vectorTable']}`",
        f"- Embedding: {config['embeddingProvider']} / {config['embeddingModel']}",
        f"- Search limit: {config['searchLimit']}, score threshold: {config['scoreThreshold']}",
    ]
    reranker = config.get("reranker")
    if reranker is not None:
        lines.append(
            f"- Reranker: {reranker['provider']} / {reranker['model']} "
            f"(topN={reranker['topN']}, threshold={reranker['threshold']})"
        )
    lines.append("")

    lines.append("## Aggregated metrics (pre-rerank)")
    lines.append("")
    lines.extend(_metrics_table(report["aggregated"], config["kValues"]))

    if "rerankedAggregated" in report:
        lines.append("")
        lines.append("## Aggregated metrics (post-rerank)")
        lines.append("")
        lines.extend(_metrics_table(report["rerankedAggregated"], config["kValues"]))

    lines.append("")
    return "\n".join(lines)


def _metrics_table(aggregated: dict[str, Any], k_values: Sequence[int]) -> list[str]:
    header = "| k | Precision@k | Recall@k | nDCG@k |"
    separator = "|---|---|---|---|"
    rows = [
        f"| {k} "
        f"| {_fmt(aggregated['precisionAtK'].get(str(k)))} "
        f"| {_fmt(aggregated['recallAtK'].get(str(k)))} "
        f"| {_fmt(aggregated['ndcgAtK'].get(str(k)))} |"
        for k in k_values
    ]
    footer = [
        "",
        f"- Hit rate: {_fmt(aggregated['hitRate'])}",
        f"- MRR: {_fmt(aggregated['mrr'])}",
    ]
    return [header, separator, *rows, *footer]


def format_summary(report: dict[str, Any]) -> str:
    """Human-readable console summary (written to stderr by the CLI)."""
    config = report["config"]
    dataset = report["dataset"]
    lines = [
        "RAG Eval — Retrieval Quality Report",
        "=" * 50,
        f"Generated:        {report['generatedAt']}",
        f"Dataset:          {dataset['path']} ({dataset['queryCount']} queries)",
        f"Profile:          {config['profile']}",
        f"Vector table:     {config['vectorTable']}",
        f"Embedding:        {config['embeddingProvider']} / {config['embeddingModel']}",
        f"Search limit:     {config['searchLimit']}",
        f"Score threshold:  {config['scoreThreshold']}",
    ]
    reranker = config.get("reranker")
    if reranker is not None:
        lines.append(
            f"Reranker:         {reranker['provider']} / {reranker['model']} "
            f"(topN={reranker['topN']}, threshold={reranker['threshold']})"
        )

    lines.append("")
    lines.append("Aggregated metrics (mean over queries, pre-rerank):")
    lines.append("")
    lines.extend(_console_table(report["aggregated"], config["kValues"]))

    if "rerankedAggregated" in report:
        lines.append("")
        lines.append("Aggregated metrics (post-rerank):")
        lines.append("")
        lines.extend(_console_table(report["rerankedAggregated"], config["kValues"]))

    return "\n".join(lines)


def _console_table(aggregated: dict[str, Any], k_values: Sequence[int]) -> list[str]:
    header = ["k", "Precision@k", "Recall@k", "NDCG@k"]
    rows = [
        [
            str(k),
            _fmt(aggregated["precisionAtK"].get(str(k))),
            _fmt(aggregated["recallAtK"].get(str(k))),
            _fmt(aggregated["ndcgAtK"].get(str(k))),
        ]
        for k in k_values
    ]
    widths = [max(len(header[i]), *(len(row[i]) for row in rows)) for i in range(len(header))]

    def fmt_row(cells: Sequence[str]) -> str:
        return "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells))

    separator = "  ".join("-" * width for width in widths)
    return [
        fmt_row(header),
        separator,
        *(fmt_row(row) for row in rows),
        "",
        f"HitRate:          {_fmt(aggregated['hitRate'])}",
        f"MRR:              {_fmt(aggregated['mrr'])}",
    ]


def _fmt(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:.4f}"
