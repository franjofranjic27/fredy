import { describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../testing/test-logger.js";
import { CACHE_MIN_SCORE, CACHE_STRONG_SCORE, TicketCacheStore } from "./ticket-cache.js";

function makeStore(rows: unknown[] = [], table = "jira_ticket_cache") {
  const query = vi.fn().mockResolvedValue({ rows });
  const store = new TicketCacheStore({ query }, table, createTestLogger().logger);
  return { store, query };
}

describe("TicketCacheStore.lookup", () => {
  it("builds a project-scoped cosine query with threshold and limit", async () => {
    const { store, query } = makeStore([
      { ticket_key: "IT-1", question_text: "vpn broken", resolution_text: "restart", score: 0.95 },
    ]);
    const hits = await store.lookup([0.1, 0.2], { projectKey: "IT" });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("1 - (embedding <=> $1::vector) AS score");
    expect(sql).toContain("WHERE project_key = $2");
    expect(sql).toContain(">= $3");
    expect(sql).toContain("LIMIT $4");
    expect(params).toEqual(["[0.1,0.2]", "IT", CACHE_MIN_SCORE, 3]);
    expect(hits).toEqual([
      {
        ticketKey: "IT-1",
        question: "vpn broken",
        resolution: "restart",
        score: 0.95,
        strong: true,
      },
    ]);
  });

  it("marks hits below the strong threshold as weak", async () => {
    const { store } = makeStore([
      { ticket_key: "IT-2", question_text: "q", resolution_text: "r", score: 0.85 },
    ]);
    const hits = await store.lookup([1], { projectKey: "IT" });
    expect(hits[0].strong).toBe(false);
    expect(CACHE_STRONG_SCORE).toBeGreaterThan(CACHE_MIN_SCORE);
  });

  it("passes custom limit and minScore through", async () => {
    const { store, query } = makeStore();
    await store.lookup([1], { projectKey: "OPS", limit: 5, minScore: 0.9 });
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(["[1]", "OPS", 0.9, 5]);
  });

  it("rejects table names that are not valid identifiers", () => {
    expect(() => makeStore([], "bad-table; DROP")).toThrow("Invalid table identifier");
  });

  it("logs and rethrows pool errors", async () => {
    const query = vi.fn().mockRejectedValue(new Error("boom"));
    const captured = createTestLogger();
    const store = new TicketCacheStore({ query }, "jira_ticket_cache", captured.logger);
    await expect(store.lookup([1], { projectKey: "IT" })).rejects.toThrow("boom");
    expect(captured.error).toHaveBeenCalled();
  });
});

describe("TicketCacheStore.upsert", () => {
  it("inserts with ON CONFLICT update on the ticket key", async () => {
    const { store, query } = makeStore();
    await store.upsert({
      ticketKey: "IT-3",
      projectKey: "IT",
      questionText: "how to vpn",
      resolutionText: "use the portal",
      embedding: [0.5, 0.6],
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO jira_ticket_cache");
    expect(sql).toContain("ON CONFLICT (ticket_key) DO UPDATE");
    expect(params).toEqual(["IT-3", "IT", "how to vpn", "use the portal", "[0.5,0.6]"]);
  });
});

describe("TicketCacheStore.recordHit", () => {
  it("increments hit_count and stamps last_hit_at", async () => {
    const { store, query } = makeStore();
    await store.recordHit("IT-4");
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("hit_count = hit_count + 1");
    expect(sql).toContain("last_hit_at = now()");
    expect(params).toEqual(["IT-4"]);
  });
});

describe("TicketCacheStore.ensureSchema", () => {
  it("creates table and both indexes idempotently", async () => {
    const { store, query } = makeStore();
    await store.ensureSchema();
    const statements = query.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toContain("CREATE TABLE IF NOT EXISTS jira_ticket_cache");
    expect(statements[1]).toContain("USING hnsw (embedding vector_cosine_ops)");
    expect(statements[2]).toContain("jira_ticket_cache_project_key_idx");
  });
});
