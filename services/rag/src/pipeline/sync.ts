import type { ConfluenceClient } from "../confluence/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { chunkHtmlContent } from "../chunking/index.js";
import type { ChunkingOptions } from "../chunking/types.js";
import type { ConfluencePage } from "../confluence/types.js";
import type { Logger } from "../logger.js";
import { getTracer } from "../tracing.js";
import { SpanStatusCode } from "@opentelemetry/api";

export interface SyncOptions {
  spaces: string[];
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
  lastSyncTime?: Date;
  logger?: Logger;
}

export interface SyncResult {
  pagesUpdated: number;
  pagesDeleted: number;
  chunksCreated: number;
  syncTime: Date;
}

interface SyncPageOptions {
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
  logger?: Logger;
}

async function syncPage(
  page: ConfluencePage,
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  result: SyncResult,
  options: SyncPageOptions,
): Promise<void> {
  const { logger } = options;
  if (!confluence.shouldIncludePage(page, { includeLabels: options.includeLabels, excludeLabels: options.excludeLabels })) {
    logger?.info("Deleting page (excluded by label)", { title: page.title, pageId: page.id });
    await qdrant.deletePageChunks(page.id);
    result.pagesDeleted++;
    return;
  }

  logger?.info("Updating page", { title: page.title });
  const metadata = confluence.extractMetadata(page);
  const chunks = chunkHtmlContent(page.body.storage.value, metadata, options.chunkingOptions);

  await qdrant.deletePageChunks(page.id);

  if (chunks.length > 0) {
    const texts = chunks.map((c) => c.content);
    const embeddings = await embedding.embed(texts);
    await qdrant.upsertChunks(chunks, embeddings);
  }

  result.pagesUpdated++;
  result.chunksCreated += chunks.length;
}

/**
 * Sync only modified pages since last sync
 */
export async function syncConfluence(
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  options: SyncOptions
): Promise<SyncResult> {
  const {
    spaces,
    includeLabels,
    excludeLabels,
    chunkingOptions,
    lastSyncTime = new Date(Date.now() - 24 * 60 * 60 * 1000), // Default: last 24 hours
    logger,
  } = options;

  const syncTime = new Date();
  const result: SyncResult = { pagesUpdated: 0, pagesDeleted: 0, chunksCreated: 0, syncTime };
  const pageOptions: SyncPageOptions = { includeLabels, excludeLabels, chunkingOptions, logger };

  const tracer = getTracer();
  const span = tracer.startSpan("rag.sync");

  try {
    for (const spaceKey of spaces) {
      logger?.info("Syncing space", { spaceKey });

      const modifiedPages = await confluence.getModifiedPages(spaceKey, lastSyncTime);
      logger?.info("Found modified pages", { spaceKey, count: modifiedPages.length });

      for (const page of modifiedPages) {
        try {
          await syncPage(page, confluence, embedding, qdrant, result, pageOptions);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger?.error("Failed to sync page", { title: page.title, pageId: page.id, error: errorMsg });
        }
      }
    }

    span.setAttribute("pages_updated", result.pagesUpdated);
    span.setAttribute("pages_deleted", result.pagesDeleted);
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
    throw error;
  } finally {
    span.end();
  }

  return result;
}
