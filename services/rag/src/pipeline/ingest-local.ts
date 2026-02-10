import type { LocalFileClient } from "../local/index.js";
import { localFileToHtml } from "../local/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { chunkHtmlContent } from "../chunking/index.js";
import type { Chunk, ChunkingOptions } from "../chunking/types.js";

export interface IngestLocalOptions {
  chunkingOptions: ChunkingOptions;
  batchSize?: number;
  verbose?: boolean;
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
  const { chunkingOptions, batchSize = 10, verbose = false } = options;

  const result: IngestLocalResult = {
    filesProcessed: 0,
    chunksCreated: 0,
    errors: [],
  };

  const log = verbose ? console.log : () => {};

  // Initialize collection
  await qdrant.initCollection();

  log("\nProcessing local files...");

  const chunksBuffer: Chunk[] = [];

  for await (const file of localFiles.getAllFiles()) {
    try {
      log(`  Processing: ${file.relativePath}`);

      // Extract metadata (returns PageMetadata with spaceKey "local")
      const metadata = localFiles.extractMetadata(file);

      // Convert to HTML for the existing chunking pipeline
      const html = localFileToHtml(file.content, file.extension);

      // Chunk the content
      const chunks = chunkHtmlContent(html, metadata, chunkingOptions);
      log(`    Created ${chunks.length} chunks`);

      // Delete existing chunks for this file (for updates)
      await qdrant.deletePageChunks(metadata.pageId);

      // Add to buffer
      chunksBuffer.push(...chunks);
      result.filesProcessed++;
      result.chunksCreated += chunks.length;

      // Process buffer when it reaches batch size
      if (chunksBuffer.length >= batchSize) {
        await processChunkBatch(
          chunksBuffer.splice(0, batchSize),
          embedding,
          qdrant,
          log
        );
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`    Error: ${errorMsg}`);
      result.errors.push({ filePath: file.relativePath, error: errorMsg });
    }
  }

  // Process remaining chunks
  if (chunksBuffer.length > 0) {
    await processChunkBatch(chunksBuffer, embedding, qdrant, log);
  }

  return result;
}

async function processChunkBatch(
  chunks: Chunk[],
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  log: (msg: string) => void
): Promise<void> {
  log(`  Embedding ${chunks.length} chunks...`);

  const texts = chunks.map((c) => c.content);
  const embeddings = await embedding.embed(texts);

  await qdrant.upsertChunks(chunks, embeddings);

  log(`  Stored ${chunks.length} chunks in Qdrant`);
}
