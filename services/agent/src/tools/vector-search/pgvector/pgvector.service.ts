import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { VectorSearchHit, VectorSearchOptions, VectorStore } from "../vector-store.interface";

interface ChunkRow {
  chunk_id: string;
  title: string | null;
  url: string | null;
  space_key: string | null;
  content: string;
  score: number;
}

/**
 * pgvector-backed vector store. Cosine similarity is computed as
 * `1 - (embedding <=> query)` since pgvector's `<=>` returns cosine distance,
 * mirroring Qdrant's cosine *similarity* score (and its 0.7 threshold).
 */
@Injectable()
export class PgVectorService implements VectorStore, OnModuleDestroy {
  readonly providerId = "pgvector";
  readonly collectionName: string;
  private readonly logger = new Logger(PgVectorService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const connectionString =
      config.get<string>("database.url") ?? "postgresql://fredy:fredy@localhost:5432/fredy";
    this.collectionName = sanitizeIdentifier(config.get<string>("database.table") ?? "chunks");
    this.pool = new Pool({ connectionString });
  }

  async search(vector: number[], options: VectorSearchOptions): Promise<VectorSearchHit[]> {
    const literal = toVectorLiteral(vector);
    const params: unknown[] = [literal];
    const where: string[] = [];

    if (typeof options.scoreThreshold === "number") {
      params.push(options.scoreThreshold);
      where.push(`(1 - (embedding <=> $1::vector)) >= $${params.length}`);
    }
    if (options.filter?.spaceKey) {
      params.push(options.filter.spaceKey);
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
      const { rows } = await this.pool.query<ChunkRow>(sql, params);
      return rows.map((row) => ({
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
      this.logger.error(`pgvector search failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${this.collectionName}`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/** Table name comes from config, not user input, but guard against injection regardless. */
function sanitizeIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table identifier: ${name}`);
  }
  return name;
}
