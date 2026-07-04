import type { Logger } from "@fredy/agent-core";

export interface VectorSearchHit {
  readonly id: string;
  readonly score: number;
  readonly payload: {
    readonly title?: string;
    readonly content: string;
    readonly url?: string;
    readonly spaceKey?: string;
  };
}

export interface VectorSearchOptions {
  readonly limit: number;
  readonly scoreThreshold?: number;
  readonly spaceKey?: string;
}

interface ChunkRow {
  chunk_id: string;
  title: string | null;
  url: string | null;
  space_key: string | null;
  content: string;
  score: number;
}

export interface QueryablePool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Table names come from config/profile, never user input — guard regardless. */
export function sanitizeIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table identifier: ${name}`);
  }
  return name;
}

function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * pgvector-backed vector store. Cosine similarity is computed as
 * `1 - (embedding <=> query)` since pgvector's `<=>` returns cosine distance.
 */
export class PgVectorStore {
  readonly providerId = "pgvector";
  readonly collectionName: string;

  constructor(
    private readonly pool: QueryablePool,
    tableName: string,
    private readonly logger: Logger,
  ) {
    this.collectionName = sanitizeIdentifier(tableName);
  }

  async search(
    vector: readonly number[],
    options: VectorSearchOptions,
  ): Promise<VectorSearchHit[]> {
    const literal = toVectorLiteral(vector);
    const params: unknown[] = [literal];
    const where: string[] = [];

    if (typeof options.scoreThreshold === "number") {
      params.push(options.scoreThreshold);
      where.push(`(1 - (embedding <=> $1::vector)) >= $${params.length}`);
    }
    if (options.spaceKey) {
      params.push(options.spaceKey);
      where.push(`space_key = $${params.length}`);
    }
    params.push(options.limit);
    const limitParam = `$${params.length}`;

    const sql = `
      SELECT chunk_id, title, url, space_key, content,
             1 - (embedding <=> $1::vector) AS score
      FROM ${this.collectionName}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY embedding <=> $1::vector ASC
      LIMIT ${limitParam}
    `;

    try {
      const { rows } = await this.pool.query(sql, params);
      return (rows as ChunkRow[]).map((row) => ({
        id: row.chunk_id,
        score: Number(row.score),
        payload: {
          title: row.title ?? undefined,
          content: row.content ?? "",
          url: row.url ?? undefined,
          spaceKey: row.space_key ?? undefined,
        },
      }));
    } catch (error) {
      this.logger.error(
        { err: error },
        `pgvector search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
