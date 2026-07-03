import type { Pool } from "pg";
import pg from "pg";
import type { Chunk, ChunkMetadata } from "../chunking/types.js";

export interface PgVectorConfig {
  databaseUrl: string;
  tableName: string;
  vectorSize: number;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

/**
 * Row shape as read back from the chunks table. Fixed columns are mapped to
 * dedicated fields; every remaining ChunkMetadata field lives in the JSONB
 * metadata column.
 */
interface ChunkRow {
  chunk_id: string;
  page_id: string;
  space_key: string | null;
  title: string | null;
  url: string | null;
  content: string;
  labels: string[] | null;
  metadata: Record<string, unknown>;
}

const UPSERT_BATCH_SIZE = 100;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * PostgreSQL + pgvector backed store for Confluence chunks.
 *
 * Mirrors the public API of the former QdrantClient so the ingestion/sync
 * pipeline stays unchanged. Distance is cosine: the `<=>` operator yields a
 * cosine *distance*, so similarity is computed as `1 - (embedding <=> query)`
 * to preserve the previous Qdrant similarity semantics (incl. scoreThreshold).
 */
export class PgVectorClient {
  private readonly pool: Pool;
  private readonly table: string;
  private readonly vectorSize: number;

  constructor(config: PgVectorConfig) {
    if (!IDENTIFIER_PATTERN.test(config.tableName)) {
      throw new Error(`Invalid table name: ${config.tableName}`);
    }
    this.pool = new pg.Pool({ connectionString: config.databaseUrl });
    this.table = `"${config.tableName}"`;
    this.vectorSize = config.vectorSize;
  }

  /**
   * Create the extension, table and indexes if they don't exist. Idempotent.
   */
  async initSchema(): Promise<void> {
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector;");

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        chunk_id   TEXT PRIMARY KEY,
        page_id    TEXT NOT NULL,
        space_key  TEXT,
        title      TEXT,
        url        TEXT,
        content    TEXT NOT NULL,
        labels     TEXT[] NOT NULL DEFAULT '{}',
        metadata   JSONB NOT NULL DEFAULT '{}',
        embedding  VECTOR(${this.vectorSize}) NOT NULL
      );
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${this.indexName("embedding_idx")}
        ON ${this.table} USING hnsw (embedding vector_cosine_ops);
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${this.indexName("space_key_idx")}
        ON ${this.table} (space_key);
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${this.indexName("page_id_idx")}
        ON ${this.table} (page_id);
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${this.indexName("labels_idx")}
        ON ${this.table} USING gin (labels);
    `);
  }

  /**
   * Upsert chunks with their embeddings in batches.
   */
  async upsertChunks(chunks: Chunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new Error("Chunks and embeddings count mismatch");
    }

    for (let i = 0; i < chunks.length; i += UPSERT_BATCH_SIZE) {
      const chunkBatch = chunks.slice(i, i + UPSERT_BATCH_SIZE);
      const embeddingBatch = embeddings.slice(i, i + UPSERT_BATCH_SIZE);
      await this.upsertBatch(chunkBatch, embeddingBatch);
    }
  }

  private async upsertBatch(chunks: Chunk[], embeddings: number[][]): Promise<void> {
    const columnsPerRow = 9;
    const values: unknown[] = [];
    const rows = chunks.map((chunk, i) => {
      const base = i * columnsPerRow;
      const { pageId, spaceKey, title, url, labels, ...rest } = chunk.metadata;
      values.push(
        chunk.id,
        pageId,
        spaceKey,
        title,
        url,
        chunk.content,
        labels ?? [],
        JSON.stringify(rest),
        this.toVectorLiteral(embeddings[i]),
      );
      return (
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}, $${base + 7}::text[], $${base + 8}::jsonb, $${base + 9}::vector)`
      );
    });

    const sql = `
      INSERT INTO ${this.table}
        (chunk_id, page_id, space_key, title, url, content, labels, metadata, embedding)
      VALUES ${rows.join(", ")}
      ON CONFLICT (chunk_id) DO UPDATE SET
        page_id   = EXCLUDED.page_id,
        space_key = EXCLUDED.space_key,
        title     = EXCLUDED.title,
        url       = EXCLUDED.url,
        content   = EXCLUDED.content,
        labels    = EXCLUDED.labels,
        metadata  = EXCLUDED.metadata,
        embedding = EXCLUDED.embedding;
    `;

    await this.pool.query(sql, values);
  }

  /**
   * Delete all chunks for a specific page.
   */
  async deletePageChunks(pageId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE page_id = $1;`, [pageId]);
  }

  /**
   * Search for similar chunks using cosine similarity.
   */
  async search(
    queryVector: number[],
    options: {
      limit?: number;
      spaceKey?: string;
      labels?: string[];
      scoreThreshold?: number;
    } = {},
  ): Promise<SearchResult[]> {
    const { limit = 5, spaceKey, labels, scoreThreshold = 0.7 } = options;

    const params: unknown[] = [this.toVectorLiteral(queryVector), scoreThreshold];
    const filters: string[] = [];

    if (spaceKey) {
      params.push(spaceKey);
      filters.push(`space_key = $${params.length}`);
    }

    if (labels?.length) {
      params.push(labels);
      filters.push(`labels && $${params.length}::text[]`);
    }

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const sql = `
      SELECT chunk_id, page_id, space_key, title, url, content, labels, metadata,
             1 - (embedding <=> $1::vector) AS score
      FROM ${this.table}
      WHERE (1 - (embedding <=> $1::vector)) >= $2
        ${filters.map((f) => `AND ${f}`).join("\n        ")}
      ORDER BY embedding <=> $1::vector ASC
      LIMIT ${limitPlaceholder};
    `;

    const result = await this.pool.query<ChunkRow & { score: number }>(sql, params);
    return result.rows.map((row) => ({
      chunk: this.rowToChunk(row),
      score: Number(row.score),
    }));
  }

  /**
   * Get store statistics. pgvector has no separate "indexed" count, so both
   * values report the total row count.
   */
  async getCollectionInfo(): Promise<{
    pointsCount: number;
    indexedVectorsCount: number;
  }> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::bigint AS count FROM ${this.table};`,
    );
    const count = Number(result.rows[0]?.count ?? 0);
    return { pointsCount: count, indexedVectorsCount: count };
  }

  /**
   * Count stored chunks grouped by space_key.
   */
  async countBySpace(): Promise<Record<string, number>> {
    const result = await this.pool.query<{ space_key: string | null; count: string }>(
      `SELECT space_key, count(*)::bigint AS count
       FROM ${this.table}
       WHERE space_key IS NOT NULL
       GROUP BY space_key;`,
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      if (row.space_key) {
        counts[row.space_key] = Number(row.count);
      }
    }
    return counts;
  }

  /**
   * List all unique page IDs stored in the table.
   */
  async listStoredPageIds(): Promise<string[]> {
    const result = await this.pool.query<{ page_id: string }>(
      `SELECT DISTINCT page_id FROM ${this.table};`,
    );
    return result.rows.map((row) => row.page_id);
  }

  /**
   * Return up to n sample chunks from the table.
   */
  async sampleRecentChunks(n: number): Promise<Chunk[]> {
    const result = await this.pool.query<ChunkRow>(
      `SELECT chunk_id, page_id, space_key, title, url, content, labels, metadata
       FROM ${this.table}
       LIMIT $1;`,
      [n],
    );
    return result.rows.map((row) => this.rowToChunk(row));
  }

  /**
   * Close the underlying connection pool.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  private rowToChunk(row: ChunkRow): Chunk {
    const metadata = row.metadata ?? {};
    return {
      id: row.chunk_id,
      content: row.content,
      metadata: {
        pageId: row.page_id,
        title: row.title,
        spaceKey: row.space_key,
        spaceName: metadata.spaceName,
        labels: row.labels ?? [],
        author: metadata.author,
        lastModified: metadata.lastModified,
        version: metadata.version,
        url: row.url,
        ancestors: metadata.ancestors,
        chunkIndex: metadata.chunkIndex,
        totalChunks: metadata.totalChunks,
        headerPath: metadata.headerPath,
        contentType: metadata.contentType,
      } as unknown as ChunkMetadata,
    };
  }

  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(",")}]`;
  }

  private indexName(suffix: string): string {
    const bare = this.table.replaceAll('"', "");
    return `"${bare}_${suffix}"`;
  }
}
