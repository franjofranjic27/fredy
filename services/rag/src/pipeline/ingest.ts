import type { ConfluenceClient } from "../confluence/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { chunkHtmlContent } from "../chunking/index.js";
import type { Chunk, ChunkingOptions } from "../chunking/types.js";

export interface IngestOptions {
  spaces: string[];
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
  batchSize?: number;
  verbose?: boolean;
}

export interface IngestResult {
  pagesProcessed: number;
  pagesSkipped: number;
  chunksCreated: number;
  errors: Array<{ pageId: string; error: string }>;
}

export async function ingestConfluenceToQdrant(
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  options: IngestOptions
): Promise<IngestResult> {
  const {
    spaces,
    includeLabels,
    excludeLabels,
    chunkingOptions,
    batchSize = 10,
    verbose = false,
  } = options;

  const result: IngestResult = {
    pagesProcessed: 0,
    pagesSkipped: 0,
    chunksCreated: 0,
    errors: [],
  };

  const log = verbose ? console.log : () => {};

  // Initialize collection
  await qdrant.initCollection();

  for (const spaceKey of spaces) {
    log(`\nProcessing space: ${spaceKey}`);

    const chunksBuffer: Chunk[] = [];

    for await (const page of confluence.getAllPagesInSpace(spaceKey)) {
      try {
        // Check label filters
        if (!confluence.shouldIncludePage(page, { includeLabels, excludeLabels })) {
          log(`  Skipping (label filter): ${page.title}`);
          result.pagesSkipped++;
          continue;
        }

        log(`  Processing: ${page.title}`);

        // Extract metadata
        const metadata = confluence.extractMetadata(page);

        // Get HTML content
        const html = page.body.storage.value;

        // Chunk the content
        const chunks = chunkHtmlContent(html, metadata, chunkingOptions);
        log(`    Created ${chunks.length} chunks`);

        // Delete existing chunks for this page (for updates)
        await qdrant.deletePageChunks(page.id);

        // Add to buffer
        chunksBuffer.push(...chunks);
        result.pagesProcessed++;
        result.chunksCreated += chunks.length;

        // Process buffer when it reaches batch size
        if (chunksBuffer.length >= batchSize) {
          await processChunkBatch(chunksBuffer.splice(0, batchSize), embedding, qdrant, log);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(`    Error: ${errorMsg}`);
        result.errors.push({ pageId: page.id, error: errorMsg });
      }
    }

    // Process remaining chunks
    if (chunksBuffer.length > 0) {
      await processChunkBatch(chunksBuffer, embedding, qdrant, log);
    }
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

  // Generate embeddings
  const texts = chunks.map((c) => c.content);
  const embeddings = await embedding.embed(texts);

  // Store in Qdrant
  await qdrant.upsertChunks(chunks, embeddings);

  log(`  Stored ${chunks.length} chunks in Qdrant`);
}
