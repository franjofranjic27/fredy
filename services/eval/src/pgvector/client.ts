import pg from "pg";

const { Pool } = pg;

export interface PgVectorConfig {
  readonly databaseUrl: string;
  readonly tableName: string;
}

export interface SearchOptions {
  readonly limit: number;
  readonly spaceKey?: string;
  readonly labels?: readonly string[];
  readonly scoreThreshold?: number;
}

export interface SearchHit {
  readonly chunkId: string;
  readonly score: number;
  readonly payload: Record<string, unknown>;
}

interface ChunkRow {
  chunk_id: string;
  page_id: string;
  space_key: string | null;
  title: string | null;
  url: string | null;
  content: string;
  labels: string[] | null;
  metadata: Record<string, unknown> | null;
  score: number | string;
}

/**
 * Read-only pgvector wrapper for the eval service. Deliberately disjoint from
 * the importer's client to keep eval decoupled and to forbid any write paths
 * (no INSERT, no UPDATE, no DDL).
 *
 * WHY score = 1 - distance: pgvector's `<=>` operator returns cosine DISTANCE
 * (0 = identical, 2 = opposite), whereas the former Qdrant score was cosine
 * SIMILARITY. Converting here keeps the eval metrics and score semantics stable
 * across the migration.
 */
export class EvalPgVectorClient {
  private readonly pool: pg.Pool;
  private readonly table: string;

  constructor(config: PgVectorConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
    this.table = quoteIdentifier(config.tableName);
  }

  async search(vector: number[], options: SearchOptions): Promise<SearchHit[]> {
    const params: unknown[] = [toVectorLiteral(vector)];
    const conditions: string[] = [];

    if (options.spaceKey !== undefined) {
      params.push(options.spaceKey);
      conditions.push(`space_key = $${params.length}`);
    }
    if (options.labels !== undefined && options.labels.length > 0) {
      params.push(options.labels);
      conditions.push(`labels @> $${params.length}`);
    }
    if (options.scoreThreshold !== undefined) {
      params.push(options.scoreThreshold);
      conditions.push(`1 - (embedding <=> $1::vector) >= $${params.length}`);
    }

    params.push(options.limit);
    const limitParam = `$${params.length}`;
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql =
      `SELECT chunk_id, page_id, space_key, title, url, content, labels, metadata, ` +
      `1 - (embedding <=> $1::vector) AS score ` +
      `FROM ${this.table} ` +
      `${where} ` +
      `ORDER BY embedding <=> $1::vector ASC ` +
      `LIMIT ${limitParam}`;

    const result = await this.pool.query<ChunkRow>(sql, params);
    return result.rows.map((row) => ({
      chunkId: row.chunk_id,
      score: Number(row.score),
      payload: toPayload(row),
    }));
  }

  async getCollectionInfo(): Promise<{ pointsCount: number }> {
    const result = await this.pool.query<{ points_count: string }>(
      `SELECT count(*)::bigint AS points_count FROM ${this.table}`,
    );
    return { pointsCount: Number(result.rows[0]?.points_count ?? 0) };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Reconstruct the flat payload shape the former Qdrant client exposed: fixed
 * columns are promoted to top level and the JSONB `metadata` fields are merged
 * in. Downstream code relies on `payload.chunkId` being present.
 */
function toPayload(row: ChunkRow): Record<string, unknown> {
  return {
    ...(row.metadata ?? {}),
    chunkId: row.chunk_id,
    pageId: row.page_id,
    spaceKey: row.space_key ?? undefined,
    title: row.title ?? undefined,
    url: row.url ?? undefined,
    content: row.content,
    labels: row.labels ?? [],
  };
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid table name "${name}". Only letters, digits and underscores are allowed.`,
    );
  }
  return `"${name}"`;
}
