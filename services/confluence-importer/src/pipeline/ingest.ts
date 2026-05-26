import type { ConfluenceClient } from "../confluence/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { chunkHtmlContent } from "../chunking/index.js";
import type { Chunk, ChunkingOptions } from "../chunking/types.js";
import type { ConfluencePage } from "../confluence/types.js";
import type { Logger } from "../logger.js";
import { getTracer } from "../tracing.js";
import { processChunkBatch } from "./chunk-batch.js";
import { SpanStatusCode } from "@opentelemetry/api";

export interface IngestOptions {
  spaces: string[];
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
  batchSize?: number;
  logger?: Logger;
}

export interface IngestResult {
  pagesProcessed: number;
  pagesSkipped: number;
  chunksCreated: number;
  errors: Array<{ pageId: string; error: string }>;
}

interface PageProcessOptions {
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
  batchSize: number;
  logger?: Logger;
}

interface ProcessContext {
  chunksBuffer: Chunk[];
  result: IngestResult;
}

async function processPage(
  page: ConfluencePage,
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  context: ProcessContext,
  options: PageProcessOptions,
): Promise<void> {
  const { logger } = options;
  if (
    !confluence.shouldIncludePage(page, {
      includeLabels: options.includeLabels,
      excludeLabels: options.excludeLabels,
    })
  ) {
    logger?.debug("Skipping page (label filter)", { title: page.title });
    context.result.pagesSkipped++;
    return;
  }

  logger?.info("Processing page", { title: page.title });
  const metadata = confluence.extractMetadata(page);
  const chunks = chunkHtmlContent(page.body.storage.value, metadata, options.chunkingOptions);
  logger?.debug("Chunks created", { title: page.title, count: chunks.length });

  await qdrant.deletePageChunks(page.id);
  context.chunksBuffer.push(...chunks);
  context.result.pagesProcessed++;
  context.result.chunksCreated += chunks.length;

  if (context.chunksBuffer.length >= options.batchSize) {
    await processChunkBatch(
      context.chunksBuffer.splice(0, options.batchSize),
      embedding,
      qdrant,
      logger,
    );
  }
}

async function processSpace(
  spaceKey: string,
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  pageOptions: PageProcessOptions,
  result: IngestResult,
): Promise<void> {
  const { logger } = pageOptions;
  logger?.info("Processing space", { spaceKey });
  const context: ProcessContext = { chunksBuffer: [], result };

  for await (const page of confluence.getAllPagesInSpace(spaceKey)) {
    try {
      await processPage(page, confluence, embedding, qdrant, context, pageOptions);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger?.error("Failed to process page", {
        pageId: page.id,
        title: page.title,
        error: errorMsg,
      });
      result.errors.push({ pageId: page.id, error: errorMsg });
    }
  }

  if (context.chunksBuffer.length > 0) {
    await processChunkBatch(context.chunksBuffer, embedding, qdrant, logger);
  }
}

export async function ingestConfluenceToQdrant(
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  options: IngestOptions,
): Promise<IngestResult> {
  const { spaces, includeLabels, excludeLabels, chunkingOptions, batchSize = 10, logger } = options;

  const result: IngestResult = {
    pagesProcessed: 0,
    pagesSkipped: 0,
    chunksCreated: 0,
    errors: [],
  };

  const pageOptions: PageProcessOptions = {
    includeLabels,
    excludeLabels,
    chunkingOptions,
    batchSize,
    logger,
  };

  const tracer = getTracer();
  const span = tracer.startSpan("rag.ingest");

  try {
    await qdrant.initCollection();

    for (const spaceKey of spaces) {
      await processSpace(spaceKey, confluence, embedding, qdrant, pageOptions, result);
    }

    span.setAttribute("pages_processed", result.pagesProcessed);
    span.setAttribute("chunks_created", result.chunksCreated);
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
    throw error;
  } finally {
    span.end();
  }

  return result;
}
