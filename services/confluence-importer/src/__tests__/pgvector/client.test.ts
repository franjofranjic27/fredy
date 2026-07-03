import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.hoisted(() => vi.fn());
const mockEnd = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({
  default: {
    // Must be a regular function so it can be invoked with `new`.
    Pool: vi.fn(function () {
      return { query: mockQuery, end: mockEnd };
    }),
  },
}));

import { PgVectorClient } from "../../pgvector/client.js";
import type { ChunkMetadata } from "../../chunking/types.js";

const defaultConfig = {
  databaseUrl: "postgresql://fredy:fredy@localhost:5432/fredy",
  tableName: "chunks",
  vectorSize: 1536,
};

function makeChunk(id: string) {
  return {
    id,
    content: `content of ${id}`,
    metadata: {
      pageId: "p1",
      title: "Test Page",
      spaceKey: "IT",
      spaceName: "IT Space",
      labels: [],
      author: "author",
      lastModified: "2024-01-01T00:00:00Z",
      version: 1,
      url: "https://example.com",
      ancestors: [],
      chunkIndex: 0,
      totalChunks: 1,
      headerPath: [],
      contentType: "text" as const,
    } satisfies ChunkMetadata,
  };
}

describe("PgVectorClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  describe("constructor", () => {
    it("rejects an invalid table name", () => {
      expect(() => new PgVectorClient({ ...defaultConfig, tableName: "bad name;" })).toThrow(
        /Invalid table name/,
      );
    });
  });

  describe("initSchema", () => {
    it("creates the extension, table and indexes", async () => {
      const client = new PgVectorClient(defaultConfig);
      await client.initSchema();

      const statements = mockQuery.mock.calls.map((call) => String(call[0]));
      expect(statements.some((s) => s.includes("CREATE EXTENSION IF NOT EXISTS vector"))).toBe(
        true,
      );
      expect(statements.some((s) => s.includes("CREATE TABLE IF NOT EXISTS"))).toBe(true);
      expect(statements.some((s) => s.includes("USING hnsw (embedding vector_cosine_ops)"))).toBe(
        true,
      );
      expect(statements.some((s) => s.includes("USING gin (labels)"))).toBe(true);
      expect(statements.some((s) => s.includes("VECTOR(1536)"))).toBe(true);
    });
  });

  describe("upsertChunks", () => {
    it("throws when chunks and embeddings count mismatch", async () => {
      const client = new PgVectorClient(defaultConfig);
      await expect(client.upsertChunks([makeChunk("c1")], [])).rejects.toThrow("mismatch");
    });

    it("inserts with an ON CONFLICT upsert and a pgvector literal", async () => {
      const client = new PgVectorClient(defaultConfig);
      await client.upsertChunks([makeChunk("c1")], [[0.1, 0.2, 0.3]]);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO");
      expect(sql).toContain("ON CONFLICT (chunk_id) DO UPDATE SET");
      // Vector serialized as a pgvector literal.
      expect(params).toContain("[0.1,0.2,0.3]");
      // chunk_id is the first bound parameter.
      expect(params[0]).toBe("c1");
    });

    it("upserts in batches of 100", async () => {
      const chunks = Array.from({ length: 250 }, (_, i) => makeChunk(`c${i}`));
      const embeddings = chunks.map(() => [0.1]);

      const client = new PgVectorClient(defaultConfig);
      await client.upsertChunks(chunks, embeddings);

      // 250 chunks → 3 batches (100 + 100 + 50)
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });
  });

  describe("deletePageChunks", () => {
    it("deletes by page_id", async () => {
      const client = new PgVectorClient(defaultConfig);
      await client.deletePageChunks("page-99");

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("DELETE FROM");
      expect(sql).toContain("WHERE page_id = $1");
      expect(params).toEqual(["page-99"]);
    });
  });

  describe("search", () => {
    it("returns mapped SearchResult objects", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            chunk_id: "c1",
            page_id: "p1",
            space_key: "IT",
            title: "Title",
            url: "https://x.com",
            content: "result content",
            labels: [],
            metadata: {
              spaceName: "IT Space",
              author: "auth",
              lastModified: "2024-01-01",
              version: 1,
              ancestors: [],
              chunkIndex: 0,
              totalChunks: 1,
              headerPath: [],
              contentType: "text",
            },
            score: 0.95,
          },
        ],
      });

      const client = new PgVectorClient(defaultConfig);
      const results = await client.search([0.1, 0.2]);

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.95);
      expect(results[0].chunk.id).toBe("c1");
      expect(results[0].chunk.content).toBe("result content");
      expect(results[0].chunk.metadata.spaceKey).toBe("IT");
      expect(results[0].chunk.metadata.spaceName).toBe("IT Space");
    });

    it("computes similarity as 1 - cosine distance and applies the threshold", async () => {
      const client = new PgVectorClient(defaultConfig);
      await client.search([0.1, 0.2], { scoreThreshold: 0.7 });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("1 - (embedding <=> $1::vector) AS score");
      expect(sql).toContain("(1 - (embedding <=> $1::vector)) >= $2");
      expect(sql).toContain("ORDER BY embedding <=> $1::vector ASC");
      expect(params[0]).toBe("[0.1,0.2]");
      expect(params[1]).toBe(0.7);
    });

    it("returns an empty array when there are no results", async () => {
      const client = new PgVectorClient(defaultConfig);
      expect(await client.search([0.1])).toHaveLength(0);
    });

    it("applies spaceKey and labels filters when provided", async () => {
      const client = new PgVectorClient(defaultConfig);
      await client.search([0.1], { spaceKey: "IT", labels: ["public"] });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("space_key = $3");
      expect(sql).toContain("labels && $4::text[]");
      expect(params).toContain("IT");
      expect(params).toContainEqual(["public"]);
    });
  });

  describe("getCollectionInfo", () => {
    it("reports the total row count for both metrics", async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: "42" }] });
      const client = new PgVectorClient(defaultConfig);
      const info = await client.getCollectionInfo();
      expect(info.pointsCount).toBe(42);
      expect(info.indexedVectorsCount).toBe(42);
    });

    it("defaults to 0 when the table is empty", async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const client = new PgVectorClient(defaultConfig);
      const info = await client.getCollectionInfo();
      expect(info.pointsCount).toBe(0);
      expect(info.indexedVectorsCount).toBe(0);
    });
  });

  describe("countBySpace", () => {
    it("aggregates chunk counts per space_key", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { space_key: "IT", count: "2" },
          { space_key: "DOCS", count: "1" },
        ],
      });

      const client = new PgVectorClient(defaultConfig);
      const counts = await client.countBySpace();

      expect(counts["IT"]).toBe(2);
      expect(counts["DOCS"]).toBe(1);
    });
  });

  describe("listStoredPageIds", () => {
    it("returns the distinct page IDs from the table", async () => {
      mockQuery.mockResolvedValue({
        rows: [{ page_id: "p1" }, { page_id: "p2" }],
      });

      const client = new PgVectorClient(defaultConfig);
      const ids = await client.listStoredPageIds();
      expect(ids).toEqual(["p1", "p2"]);
    });
  });

  describe("sampleRecentChunks", () => {
    it("limits the sample to n rows", async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const client = new PgVectorClient(defaultConfig);
      await client.sampleRecentChunks(3);

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("LIMIT $1");
      expect(params).toEqual([3]);
    });
  });
});
