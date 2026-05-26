import { loadConfig } from "./config/env.js";
import { DatasetNotFoundError, DatasetParseError, loadDataset } from "./dataset/loader.js";
import { createEmbeddingClient } from "./embedding/client.js";
import { EvalQdrantClient } from "./qdrant/client.js";
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

  const qdrant = new EvalQdrantClient({
    url: config.qdrant.url,
    collectionName: config.qdrant.collection,
    apiKey: config.qdrant.apiKey,
  });

  const runner = new EvalRunner(
    { embedding, qdrant },
    {
      kValues: config.runner.kValues,
      searchLimit: config.runner.searchLimit,
      scoreThreshold: config.runner.scoreThreshold,
    },
  );

  const report = await runner.run(cases, {
    qdrantCollection: config.qdrant.collection,
    embeddingProvider: config.embedding.provider,
    datasetPath: config.dataset.path,
  });

  const reportPath = await writeReport(report, config.runner.reportsDir);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`\n${formatSummary(report)}\n\nReport written to: ${reportPath}\n`);
}

main().catch((error: unknown) => {
  if (error instanceof DatasetNotFoundError || error instanceof DatasetParseError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`Eval run failed: ${message}\n`);
  process.exit(1);
});
