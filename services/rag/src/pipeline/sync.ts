import type { ConfluenceClient } from "../confluence/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { chunkHtmlContent } from "../chunking/index.js";
import type { ChunkingOptions } from "../chunking/types.js";

export interface SyncOptions {
  spaces: string[];
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
  lastSyncTime?: Date;
  verbose?: boolean;
}

export interface SyncResult {
  pagesUpdated: number;
  pagesDeleted: number;
  chunksCreated: number;
  syncTime: Date;
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
    verbose = false,
  } = options;

  const log = verbose ? console.log : () => {};
  const syncTime = new Date();

  const result: SyncResult = {
    pagesUpdated: 0,
    pagesDeleted: 0,
    chunksCreated: 0,
    syncTime,
  };

  for (const spaceKey of spaces) {
    log(`\nSyncing space: ${spaceKey}`);

    // Get modified pages
    const modifiedPages = await confluence.getModifiedPages(spaceKey, lastSyncTime);
    log(`  Found ${modifiedPages.length} modified pages`);

    for (const page of modifiedPages) {
      try {
        // Check label filters
        if (!confluence.shouldIncludePage(page, { includeLabels, excludeLabels })) {
          // Page now has exclude label - delete from Qdrant
          log(`  Deleting (excluded by label): ${page.title}`);
          await qdrant.deletePageChunks(page.id);
          result.pagesDeleted++;
          continue;
        }

        log(`  Updating: ${page.title}`);

        // Extract metadata and chunk
        const metadata = confluence.extractMetadata(page);
        const html = page.body.storage.value;
        const chunks = chunkHtmlContent(html, metadata, chunkingOptions);

        // Delete old chunks and insert new
        await qdrant.deletePageChunks(page.id);

        if (chunks.length > 0) {
          const texts = chunks.map((c) => c.content);
          const embeddings = await embedding.embed(texts);
          await qdrant.upsertChunks(chunks, embeddings);
        }

        result.pagesUpdated++;
        result.chunksCreated += chunks.length;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(`    Error updating ${page.title}: ${errorMsg}`);
      }
    }
  }

  return result;
}
