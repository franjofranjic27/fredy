import type { EvalReport } from "./types.js";

export function formatSummary(report: EvalReport): string {
  const { aggregated, config, dataset } = report;
  const lines: string[] = [];

  lines.push("Fredy Eval — Retrieval Quality Report");
  lines.push("=".repeat(50));
  lines.push(`Generated:        ${report.generatedAt}`);
  lines.push(`Dataset:          ${dataset.path} (${dataset.queryCount} queries)`);
  lines.push(`Qdrant:           ${config.qdrantCollection}`);
  lines.push(`Embedding:        ${config.embeddingProvider} / ${config.embeddingModel}`);
  lines.push(`Search limit:     ${config.searchLimit}`);
  lines.push(`Score threshold:  ${config.scoreThreshold}`);
  lines.push("");
  lines.push("Aggregated metrics (mean over queries):");
  lines.push("");

  const header = ["k", "Precision@k", "Recall@k", "NDCG@k"];
  const rows = config.kValues.map((k) => [
    String(k),
    fmt(aggregated.precisionAtK[String(k)]),
    fmt(aggregated.recallAtK[String(k)]),
    fmt(aggregated.ndcgAtK[String(k)]),
  ]);
  lines.push(renderTable(header, rows));
  lines.push("");
  lines.push(`HitRate:          ${fmt(aggregated.hitRate)}`);
  lines.push(`MRR:              ${fmt(aggregated.mrr)}`);

  return lines.join("\n");
}

function fmt(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(4);
}

function renderTable(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  );
  const fmtRow = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i], " ")).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [fmtRow(header), sep, ...rows.map(fmtRow)].join("\n");
}
