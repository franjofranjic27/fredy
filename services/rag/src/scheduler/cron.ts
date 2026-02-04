import cron from "node-cron";
import type { ConfluenceClient } from "../confluence/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { syncConfluence } from "../pipeline/index.js";
import type { ChunkingOptions } from "../chunking/types.js";

export interface SchedulerConfig {
  cronSchedule: string;
  spaces: string[];
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
}

export function startSyncScheduler(
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  config: SchedulerConfig
): cron.ScheduledTask {
  let lastSyncTime = new Date();

  console.log(`Starting sync scheduler with cron: ${config.cronSchedule}`);

  const task = cron.schedule(config.cronSchedule, async () => {
    console.log(`\n[${new Date().toISOString()}] Starting scheduled sync...`);

    try {
      const result = await syncConfluence(confluence, embedding, qdrant, {
        spaces: config.spaces,
        includeLabels: config.includeLabels,
        excludeLabels: config.excludeLabels,
        chunkingOptions: config.chunkingOptions,
        lastSyncTime,
        verbose: true,
      });

      console.log(`Sync complete:`);
      console.log(`  Pages updated: ${result.pagesUpdated}`);
      console.log(`  Pages deleted: ${result.pagesDeleted}`);
      console.log(`  Chunks created: ${result.chunksCreated}`);

      lastSyncTime = result.syncTime;
    } catch (error) {
      console.error("Sync failed:", error);
    }
  });

  return task;
}
