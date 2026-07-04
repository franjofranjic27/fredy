import { sanitizeIdentifier, type Logger, type QueryablePool } from "@fredy/agent-core";

/** Hits below this cosine similarity are dropped entirely. */
export const CACHE_MIN_SCORE = 0.8;
/** Hits at or above this similarity are presented as strong matches. */
export const CACHE_STRONG_SCORE = 0.92;

export interface CacheHit {
  readonly ticketKey: string;
  readonly question: string;
  readonly resolution: string;
  readonly score: number;
  readonly strong: boolean;
}

export interface CacheLookupOptions {
  readonly projectKey: string;
  readonly limit?: number;
  readonly minScore?: number;
}

export interface CacheEntry {
  readonly ticketKey: string;
  readonly projectKey: string;
  readonly questionText: string;
  readonly resolutionText: string;
  readonly embedding: readonly number[];
}

interface CacheRow {
  ticket_key: string;
  question_text: string;
  resolution_text: string;
  score: number;
}

function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * pgvector-backed semantic cache of resolved tickets. Same cosine convention
 * as PgVectorStore: `1 - (embedding <=> query)`. The embedding dimension must
 * match the chunks table — both use the same embedding provider.
 */
export class TicketCacheStore {
  private readonly tableName: string;

  constructor(
    private readonly pool: QueryablePool,
    tableName: string,
    private readonly logger: Logger,
  ) {
    this.tableName = sanitizeIdentifier(tableName);
  }

  /** Idempotent bootstrap, mirroring infrastructure/postgres/init.sql. */
  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        ticket_key      TEXT PRIMARY KEY,
        project_key     TEXT NOT NULL,
        question_text   TEXT NOT NULL,
        resolution_text TEXT NOT NULL,
        embedding       VECTOR(1536) NOT NULL,
        source          TEXT NOT NULL DEFAULT 'agent',
        hit_count       INTEGER NOT NULL DEFAULT 0,
        last_hit_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${this.tableName}_embedding_idx
        ON ${this.tableName} USING hnsw (embedding vector_cosine_ops)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${this.tableName}_project_key_idx
        ON ${this.tableName} (project_key)
    `);
  }

  async lookup(vector: readonly number[], options: CacheLookupOptions): Promise<CacheHit[]> {
    const limit = options.limit ?? 3;
    const minScore = options.minScore ?? CACHE_MIN_SCORE;
    const sql = `
      SELECT ticket_key, question_text, resolution_text,
             1 - (embedding <=> $1::vector) AS score
      FROM ${this.tableName}
      WHERE project_key = $2
        AND (1 - (embedding <=> $1::vector)) >= $3
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $4
    `;
    try {
      const { rows } = await this.pool.query(sql, [
        toVectorLiteral(vector),
        options.projectKey,
        minScore,
        limit,
      ]);
      return (rows as CacheRow[]).map((row) => {
        const score = Number(row.score);
        return {
          ticketKey: row.ticket_key,
          question: row.question_text,
          resolution: row.resolution_text,
          score,
          strong: score >= CACHE_STRONG_SCORE,
        };
      });
    } catch (error) {
      this.logger.error(
        { err: error },
        `Ticket cache lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async upsert(entry: CacheEntry): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ${this.tableName}
        (ticket_key, project_key, question_text, resolution_text, embedding)
      VALUES ($1, $2, $3, $4, $5::vector)
      ON CONFLICT (ticket_key) DO UPDATE SET
        project_key = EXCLUDED.project_key,
        question_text = EXCLUDED.question_text,
        resolution_text = EXCLUDED.resolution_text,
        embedding = EXCLUDED.embedding
    `,
      [
        entry.ticketKey,
        entry.projectKey,
        entry.questionText,
        entry.resolutionText,
        toVectorLiteral(entry.embedding),
      ],
    );
  }

  /** Observability for cache quality: which entries actually get reused. */
  async recordHit(ticketKey: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.tableName} SET hit_count = hit_count + 1, last_hit_at = now() WHERE ticket_key = $1`,
      [ticketKey],
    );
  }
}
