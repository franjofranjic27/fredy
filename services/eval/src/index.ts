import { loadConfig } from "./config/env.js";
import { DatasetNotFoundError, DatasetParseError, loadDataset } from "./dataset/loader.js";
import { createEmbeddingClient } from "./embedding/client.js";
import { EvalPgVectorClient } from "./pgvector/client.js";
import { formatSummary } from "./runner/console-summary.js";
import { EvalRunner } from "./runner/eval-runner.js";
import { writeReport } from "./runner/report-writer.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const cases = await loadDataset(config.dataset.path);

  const embedding = createEmbeddingClient({
    provider: config.embedding.provider,
    apiKey: config.embedding.apiKey,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });

  const store = new EvalPgVectorClient({
    databaseUrl: config.database.url,
    tableName: config.database.table,
  });

  const runner = new EvalRunner(
    { embedding, store },
    {
      kValues: config.runner.kValues,
      searchLimit: config.runner.searchLimit,
      scoreThreshold: config.runner.scoreThreshold,
    },
  );

  try {
    const report = await runner.run(cases, {
      vectorTable: config.database.table,
      embeddingProvider: config.embedding.provider,
      datasetPath: config.dataset.path,
    });

    const reportPath = await writeReport(report, config.runner.reportsDir);

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(`\n${formatSummary(report)}\n\nReport written to: ${reportPath}\n`);
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof DatasetNotFoundError || error instanceof DatasetParseError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Eval run failed: ${message}\n`);
  process.exit(1);
});
