import { describe, expect, it, vi } from "vitest";
import { PgVectorStore, sanitizeIdentifier } from "./pgvector.js";
import { createTestLogger } from "../testing/test-logger.js";

function makeStore(rows: unknown[] = [], table = "chunks") {
  const query = vi.fn().mockResolvedValue({ rows });
  const store = new PgVectorStore({ query }, table, createTestLogger().logger);
  return { store, query };
}

describe("PgVectorStore.search", () => {
  it("builds a cosine search query with score threshold and space filter", async () => {
    const { store, query } = makeStore([
      {
        chunk_id: "1",
        title: "VPN",
        url: "https://x",
        space_key: "IT",
        content: "How to VPN",
        score: 0.91,
      },
    ]);

    const hits = await store.search([0.1, 0.2], {
      limit: 5,
      scoreThreshold: 0.7,
      spaceKey: "IT",
    });

    expect(hits).toEqual([
      {
        id: "1",
        score: 0.91,
        payload: { title: "VPN", content: "How to VPN", url: "https://x", spaceKey: "IT" },
      },
    ]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("1 - (embedding <=> $1::vector) AS score");
    expect(sql).toContain("(1 - (embedding <=> $1::vector)) >= $2");
    expect(sql).toContain("space_key = $3");
    expect(sql).toContain("ORDER BY embedding <=> $1::vector ASC");
    expect(sql).toContain("FROM chunks");
    expect(params).toEqual(["[0.1,0.2]", 0.7, "IT", 5]);
  });

  it("omits WHERE clauses when neither threshold nor filter is given", async () => {
    const { store, query } = makeStore([]);

    const hits = await store.search([0.5], { limit: 3 });

    expect(hits).toEqual([]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain("WHERE");
    expect(params).toEqual(["[0.5]", 3]);
  });

  it("maps null payload columns to safe defaults", async () => {
    const { store } = makeStore([
      { chunk_id: "2", title: null, url: null, space_key: null, content: "c", score: 0.5 },
    ]);

    const hits = await store.search([0], { limit: 1 });

    expect(hits[0].payload).toEqual({
      title: undefined,
      content: "c",
      url: undefined,
      spaceKey: undefined,
    });
  });

  it("propagates and logs query errors", async () => {
    const query = vi.fn().mockRejectedValue(new Error("connection refused"));
    const log = createTestLogger();
    const store = new PgVectorStore({ query }, "chunks", log.logger);

    await expect(store.search([0], { limit: 1 })).rejects.toThrow("connection refused");
    expect(log.error).toHaveBeenCalled();
  });
});

describe("identifier handling", () => {
  it("exposes providerId and collectionName", () => {
    const { store } = makeStore([], "chunks");
    expect(store.providerId).toBe("pgvector");
    expect(store.collectionName).toBe("chunks");
  });

  it("rejects an invalid table identifier to guard against injection", () => {
    expect(() => makeStore([], "chunks; DROP TABLE x")).toThrow(/Invalid table identifier/);
  });

  it("sanitizeIdentifier accepts snake_case names", () => {
    expect(sanitizeIdentifier("chunks_v2")).toBe("chunks_v2");
    expect(() => sanitizeIdentifier("1bad")).toThrow(/Invalid table identifier/);
    expect(() => sanitizeIdentifier('bad"name')).toThrow(/Invalid table identifier/);
  });
});
