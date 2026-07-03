import pg from "pg";
import type { SampledChunk, SampledChunkMetadata } from "./types.js";
import { SeededRng } from "./rng.js";

const { Pool } = pg;

export interface PgVectorSamplerConfig {
  readonly databaseUrl: string;
  readonly tableName: string;
}

export interface SampleOptions {
  readonly spaceKey?: string;
}

interface ChunkRow {
  chunk_id: string;
  page_id: string;
  space_key: string | null;
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Read-only wrapper around the pgvector `chunks` table. Used by the dataset
 * generator to draw a reproducible sample of chunks from the corpus.
 */
export class PgVectorSampler {
  private readonly pool: pg.Pool;
  private readonly table: string;

  constructor(config: PgVectorSamplerConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
    this.table = quoteIdentifier(config.tableName);
  }

  /**
   * Draw n chunks from the corpus.
   *
   * WHY DB-side `ORDER BY random()` instead of app-side scroll-then-shuffle:
   * Postgres samples across the whole table in one round trip, avoiding the
   * former need to page through every point just to shuffle in memory. The
   * seed is pushed to Postgres via `setseed` on a dedicated connection so the
   * `--seed` reproducibility contract still holds.
   */
  async sampleChunks(
    n: number,
    rng: SeededRng,
    options: SampleOptions = {},
  ): Promise<SampledChunk[]> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT setseed($1)", [deriveSeed(rng)]);

      const params: unknown[] = [];
      let where = "";
      if (options.spaceKey !== undefined) {
        params.push(options.spaceKey);
        where = `WHERE space_key = $${params.length}`;
      }
      params.push(n);
      const limitParam = `$${params.length}`;

      const result = await client.query<ChunkRow>(
        `SELECT chunk_id, page_id, space_key, title, content, metadata ` +
          `FROM ${this.table} ${where} ORDER BY random() LIMIT ${limitParam}`,
        params,
      );
      return mapRows(result.rows);
    } finally {
      client.release();
    }
  }

  /**
   * Return all chunks of a given page, in chunkIndex order.
   */
  async getChunksByPageId(pageId: string): Promise<SampledChunk[]> {
    const result = await this.pool.query<ChunkRow>(
      `SELECT chunk_id, page_id, space_key, title, content, metadata ` +
        `FROM ${this.table} WHERE page_id = $1`,
      [pageId],
    );
    return mapRows(result.rows).sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function mapRows(rows: ChunkRow[]): SampledChunk[] {
  return rows.map(toSampledChunk).filter((c): c is SampledChunk => c !== null);
}

function toSampledChunk(row: ChunkRow): SampledChunk | null {
  const metadata = row.metadata ?? {};
  const chunkIndex = metadata.chunkIndex;
  const totalChunks = metadata.totalChunks;

  if (
    typeof row.chunk_id !== "string" ||
    typeof row.page_id !== "string" ||
    typeof row.content !== "string" ||
    typeof row.title !== "string" ||
    typeof row.space_key !== "string" ||
    typeof chunkIndex !== "number" ||
    typeof totalChunks !== "number"
  ) {
    return null;
  }

  const headerPath = Array.isArray(metadata.headerPath)
    ? metadata.headerPath.filter((v): v is string => typeof v === "string")
    : [];
  const spaceName = typeof metadata.spaceName === "string" ? metadata.spaceName : undefined;

  const chunkMetadata: SampledChunkMetadata = {
    title: row.title,
    spaceKey: row.space_key,
    spaceName,
    headerPath,
    chunkIndex,
    totalChunks,
  };

  return {
    chunkId: row.chunk_id,
    pageId: row.page_id,
    content: row.content,
    metadata: chunkMetadata,
  };
}

/**
 * Map a SeededRng draw into the [-1, 1] range Postgres' `setseed` expects,
 * keeping DB-side sampling deterministic for a given seed.
 */
function deriveSeed(rng: SeededRng): number {
  return rng.next() * 2 - 1;
}

function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid table name "${name}". Only letters, digits and underscores are allowed.`,
    );
  }
  return `"${name}"`;
}
