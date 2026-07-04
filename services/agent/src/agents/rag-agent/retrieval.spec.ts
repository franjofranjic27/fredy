import { describe, expect, it, vi } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolRegistry } from "@fredy/agent-core";
import { retrieveContext, type RetrievalDeps } from "./retrieval.js";
import type { Reranker } from "../../rerank/reranker.js";
import type { VectorSearchHit } from "../../tools/pgvector.js";
import { createTestLogger, type CapturingLogger } from "../../testing/test-logger.js";

function hit(id: string, content: string, score = 0.9): VectorSearchHit {
  return { id, score, payload: { title: `Doc ${id}`, content, url: `https://wiki/${id}` } };
}

type SearchFn = (input: {
  query: string;
  limit?: number;
  spaceKey?: string;
}) => Promise<[string, { hits: VectorSearchHit[] }]>;

function stubVectorSearchTool(search: SearchFn) {
  const execute = vi.fn(search);
  const stub = tool(execute as SearchFn, {
    name: "vector_search",
    description: "stub",
    schema: z.object({
      query: z.string(),
      limit: z.number().optional(),
      spaceKey: z.string().optional(),
    }),
    responseFormat: "content_and_artifact",
  });
  return { stub, execute };
}

function makeDeps(
  search: SearchFn,
  overrides: Partial<RetrievalDeps> = {},
): { deps: RetrievalDeps; execute: ReturnType<typeof vi.fn>; log: CapturingLogger } {
  const registry = new ToolRegistry();
  const { stub, execute } = stubVectorSearchTool(search);
  registry.register(stub);
  const log = createTestLogger();
  return {
    deps: {
      toolRegistry: registry,
      reranker: null,
      rerankTopN: 10,
      rerankThreshold: 0,
      defaultLimit: 5,
      logger: log.logger,
      ...overrides,
    },
    execute,
    log,
  };
}

const found =
  (content: string, hits: VectorSearchHit[]): SearchFn =>
  async () => [content, { hits }];

const nothing: SearchFn = async () => ["No relevant documents found.", { hits: [] }];

describe("retrieveContext", () => {
  it("returns null and logs a retrieval event when vector_search is not registered", async () => {
    const log = createTestLogger();
    const deps: RetrievalDeps = {
      toolRegistry: new ToolRegistry(),
      reranker: null,
      rerankTopN: 10,
      rerankThreshold: 0,
      defaultLimit: 5,
      logger: log.logger,
    };
    const result = await retrieveContext("anything", { requestId: "r1" }, deps);
    expect(result).toBeNull();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ type: "retrieval", resultCount: 0 }),
    );
  });

  it("returns null when vector_search is registered but denied by RBAC", async () => {
    const { deps } = makeDeps(found("X", [hit("1", "X")]));
    const result = await retrieveContext(
      "anything",
      { requestId: "r1", allowedToolNames: ["fetch_url"] },
      deps,
    );
    expect(result).toBeNull();
  });

  it("invokes vector_search with the default limit and returns Query-prefixed context", async () => {
    const { deps, execute, log } = makeDeps(found("VPN setup steps...", [hit("1", "VPN")]));
    const result = await retrieveContext("VPN setup", { requestId: "r1" }, deps);
    expect(result).toBe("Query: VPN setup\nVPN setup steps...");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ query: "VPN setup", limit: 5 }),
      expect.anything(),
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "retrieval",
        resultCount: 1,
        chunks: [
          expect.objectContaining({ id: "1", score: 0.9, url: "https://wiki/1", title: "Doc 1" }),
        ],
      }),
    );
  });

  it("joins blocks of multiple queries with the --- separator", async () => {
    const { deps } = makeDeps(async ({ query }) => [
      `docs for ${query}`,
      { hits: [hit(query, "c")] },
    ]);
    const result = await retrieveContext(
      "VPN einrichten und WLAN konfigurieren",
      { requestId: "r1" },
      deps,
    );
    expect(result).toContain("Query: VPN einrichten und WLAN konfigurieren\n");
    expect(result).toContain("\n\n---\n\n");
    expect(result).toContain("Query: WLAN konfigurieren\ndocs for WLAN konfigurieren");
  });

  it("retries with the raw user message when query expansion yields nothing", async () => {
    let calls = 0;
    const { deps, execute } = makeDeps(async () => {
      calls += 1;
      if (calls <= 3) return ["No relevant documents found.", { hits: [] }];
      return ["fallback hit", { hits: [hit("z", "fallback hit")] }];
    });
    const result = await retrieveContext(
      "VPN setup? And WiFi password?",
      { requestId: "r1" },
      deps,
    );
    expect(result).toContain("fallback hit");
    expect(execute.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("returns null when every query yields no hits", async () => {
    const { deps } = makeDeps(nothing);
    const result = await retrieveContext("unknown topic", { requestId: "r1" }, deps);
    expect(result).toBeNull();
  });

  it("forwards the spaceKey filter to the tool", async () => {
    const { deps, execute } = makeDeps(found("result", [hit("1", "r")]));
    await retrieveContext("test query", { requestId: "r1", spaceKey: "IT" }, deps);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ spaceKey: "IT" }),
      expect.anything(),
    );
  });

  it("logs the error and returns null when the tool fails", async () => {
    const { deps, log } = makeDeps(async () => {
      throw new Error("vector store down");
    });
    const result = await retrieveContext("test query", { requestId: "r1" }, deps);
    expect(result).toBeNull();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "retrieval",
        resultCount: 0,
        error: expect.objectContaining({
          code: "tool_error",
          message: expect.stringContaining("vector store down"),
        }),
      }),
    );
  });

  describe("reranking", () => {
    const twoHits = [hit("a", "content a", 0.9), hit("b", "content b", 0.8)];

    function makeReranker(results: Array<{ id: string; score: number }>): Reranker {
      return {
        provider: "cohere",
        model: "rerank-v3.5",
        rerank: vi.fn().mockResolvedValue(results),
      };
    }

    it("rebuilds the context in reranked order with rerank scores", async () => {
      const reranker = makeReranker([
        { id: "b", score: 0.99 },
        { id: "a", score: 0.42 },
      ]);
      const { deps } = makeDeps(found("block", twoHits), { reranker });
      const result = await retrieveContext("test query", { requestId: "r1" }, deps);
      expect(result).toBe(
        "### Doc b (score=0.990)\nSource: https://wiki/b\ncontent b\n\n---\n\n### Doc a (score=0.420)\nSource: https://wiki/a\ncontent a",
      );
      expect(reranker.rerank).toHaveBeenCalledWith(
        "test query",
        [
          { id: "a", content: "content a" },
          { id: "b", content: "content b" },
        ],
        10,
      );
    });

    it("drops results below the rerank threshold", async () => {
      const reranker = makeReranker([
        { id: "b", score: 0.9 },
        { id: "a", score: 0.1 },
      ]);
      const { deps } = makeDeps(found("block", twoHits), { reranker, rerankThreshold: 0.5 });
      const result = await retrieveContext("test query", { requestId: "r1" }, deps);
      expect(result).toContain("Doc b");
      expect(result).not.toContain("Doc a");
    });

    it("returns null when nothing survives the threshold", async () => {
      const reranker = makeReranker([{ id: "a", score: 0.1 }]);
      const { deps } = makeDeps(found("block", twoHits), { reranker, rerankThreshold: 0.5 });
      const result = await retrieveContext("test query", { requestId: "r1" }, deps);
      expect(result).toBeNull();
    });

    it("skips reranker results whose id is not in the candidate pool", async () => {
      const reranker = makeReranker([
        { id: "ghost", score: 0.99 },
        { id: "b", score: 0.8 },
        { id: "a", score: 0.7 },
      ]);
      const { deps } = makeDeps(found("block", twoHits), { reranker });
      const result = await retrieveContext("test query", { requestId: "r1" }, deps);
      // The unknown "ghost" id is dropped, real hits are kept, nothing throws.
      expect(result).toContain("Doc b");
      expect(result).toContain("Doc a");
      expect(result).not.toContain("ghost");
    });

    it("returns null when every reranked id is unknown", async () => {
      const reranker = makeReranker([{ id: "ghost", score: 0.99 }]);
      const { deps } = makeDeps(found("block", twoHits), { reranker });
      const result = await retrieveContext("test query", { requestId: "r1" }, deps);
      expect(result).toBeNull();
    });

    it("falls back to the unreranked context when the reranker fails", async () => {
      const reranker: Reranker = {
        provider: "voyage",
        model: "rerank-2.5",
        rerank: vi.fn().mockRejectedValue(new Error("rerank api down")),
      };
      const { deps, log } = makeDeps(found("block content", twoHits), { reranker });
      const result = await retrieveContext("test query", { requestId: "r1" }, deps);
      expect(result).toBe("Query: test query\nblock content");
      expect(log.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Reranking failed"),
      );
    });
  });
});
