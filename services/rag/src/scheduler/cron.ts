import cron from "node-cron";
import type { ConfluenceClient } from "../confluence/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { syncConfluence } from "../pipeline/index.js";
import type { ChunkingOptions } from "../chunking/types.js";
import type { Logger } from "../logger.js";

export interface SchedulerConfig {
  cronSchedule: string;
  spaces: string[];
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
  logger?: Logger;
}

export function startSyncScheduler(
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  config: SchedulerConfig
): cron.ScheduledTask {
  const { logger } = config;
  let lastSyncTime = new Date();
  let syncInProgress = false;

  logger?.info("Starting sync scheduler", { cronSchedule: config.cronSchedule });

  const task = cron.schedule(config.cronSchedule, async () => {
    if (syncInProgress) {
      logger?.warn("Sync already in progress, skipping scheduled run");
      return;
    }

    syncInProgress = true;
    logger?.info("Starting scheduled sync");

    try {
      const result = await syncConfluence(confluence, embedding, qdrant, {
        spaces: config.spaces,
        includeLabels: config.includeLabels,
        excludeLabels: config.excludeLabels,
        chunkingOptions: config.chunkingOptions,
        lastSyncTime,
        logger,
      });

      logger?.info("Scheduled sync complete", {
        pagesUpdated: result.pagesUpdated,
        pagesDeleted: result.pagesDeleted,
        chunksCreated: result.chunksCreated,
      });

      lastSyncTime = result.syncTime;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger?.error("Scheduled sync failed", { error: errorMsg });
    } finally {
      syncInProgress = false;
    }
  });

  return task;
}
