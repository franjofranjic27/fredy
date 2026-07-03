import type { EmbeddingClient } from "../embeddings/index.js";
import type { PgVectorClient } from "../pgvector/index.js";
import type { Chunk } from "../chunking/types.js";
import type { Logger } from "../logger.js";

export async function processChunkBatch(
  chunks: Chunk[],
  embedding: EmbeddingClient,
  store: PgVectorClient,
  logger: Logger | undefined,
): Promise<void> {
  logger?.debug("Embedding chunk batch", { count: chunks.length });
  const texts = chunks.map((c) => c.content);
  const embeddings = await embedding.embed(texts);
  await store.upsertChunks(chunks, embeddings);
  logger?.debug("Stored chunk batch in vector store", { count: chunks.length });
}
