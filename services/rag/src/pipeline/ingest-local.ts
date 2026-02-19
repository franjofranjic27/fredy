import type { LocalFileClient } from "../local/index.js";
import { localFileToHtml } from "../local/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { chunkHtmlContent } from "../chunking/index.js";
import type { Chunk, ChunkingOptions } from "../chunking/types.js";
import type { Logger } from "../logger.js";

export interface IngestLocalOptions {
  chunkingOptions: ChunkingOptions;
  batchSize?: number;
  logger?: Logger;
}

export interface IngestLocalResult {
  filesProcessed: number;
  chunksCreated: number;
  errors: Array<{ filePath: string; error: string }>;
}

export async function ingestLocalFiles(
  localFiles: LocalFileClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  options: IngestLocalOptions
): Promise<IngestLocalResult> {
  const { chunkingOptions, batchSize = 10, logger } = options;

  const result: IngestLocalResult = {
    filesProcessed: 0,
    chunksCreated: 0,
    errors: [],
  };

  await qdrant.initCollection();

  logger?.info("Processing local files");

  const chunksBuffer: Chunk[] = [];

  for await (const file of localFiles.getAllFiles()) {
    try {
      logger?.info("Processing file", { path: file.relativePath });

      const metadata = localFiles.extractMetadata(file);
      const html = localFileToHtml(file.content, file.extension);
      const chunks = chunkHtmlContent(html, metadata, chunkingOptions);
      logger?.debug("Chunks created", { path: file.relativePath, count: chunks.length });

      await qdrant.deletePageChunks(metadata.pageId);

      chunksBuffer.push(...chunks);
      result.filesProcessed++;
      result.chunksCreated += chunks.length;

      if (chunksBuffer.length >= batchSize) {
        await processChunkBatch(chunksBuffer.splice(0, batchSize), embedding, qdrant, logger);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger?.error("Failed to process file", { path: file.relativePath, error: errorMsg });
      result.errors.push({ filePath: file.relativePath, error: errorMsg });
    }
  }

  if (chunksBuffer.length > 0) {
    await processChunkBatch(chunksBuffer, embedding, qdrant, logger);
  }

  return result;
}

async function processChunkBatch(
  chunks: Chunk[],
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  logger: Logger | undefined,
): Promise<void> {
  logger?.debug("Embedding chunk batch", { count: chunks.length });

  const texts = chunks.map((c) => c.content);
  const embeddings = await embedding.embed(texts);

  await qdrant.upsertChunks(chunks, embeddings);

  logger?.debug("Stored chunk batch in Qdrant", { count: chunks.length });
}
