import type { ConfluenceClient } from "../confluence/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { chunkHtmlContent } from "../chunking/index.js";
import type { Chunk, ChunkingOptions } from "../chunking/types.js";
import type { ConfluencePage } from "../confluence/types.js";

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

interface PageProcessOptions {
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
  batchSize: number;
}

async function processPage(
  page: ConfluencePage,
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  chunksBuffer: Chunk[],
  result: IngestResult,
  options: PageProcessOptions,
  log: (msg: string) => void,
): Promise<void> {
  if (!confluence.shouldIncludePage(page, { includeLabels: options.includeLabels, excludeLabels: options.excludeLabels })) {
    log(`  Skipping (label filter): ${page.title}`);
    result.pagesSkipped++;
    return;
  }

  log(`  Processing: ${page.title}`);
  const metadata = confluence.extractMetadata(page);
  const chunks = chunkHtmlContent(page.body.storage.value, metadata, options.chunkingOptions);
  log(`    Created ${chunks.length} chunks`);

  await qdrant.deletePageChunks(page.id);
  chunksBuffer.push(...chunks);
  result.pagesProcessed++;
  result.chunksCreated += chunks.length;

  if (chunksBuffer.length >= options.batchSize) {
    await processChunkBatch(chunksBuffer.splice(0, options.batchSize), embedding, qdrant, log);
  }
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
  const pageOptions: PageProcessOptions = { includeLabels, excludeLabels, chunkingOptions, batchSize };

  await qdrant.initCollection();

  for (const spaceKey of spaces) {
    log(`\nProcessing space: ${spaceKey}`);
    const chunksBuffer: Chunk[] = [];

    for await (const page of confluence.getAllPagesInSpace(spaceKey)) {
      try {
        await processPage(page, confluence, embedding, qdrant, chunksBuffer, result, pageOptions, log);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(`    Error: ${errorMsg}`);
        result.errors.push({ pageId: page.id, error: errorMsg });
      }
    }

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
