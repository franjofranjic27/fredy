import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKnowledgeBaseTool } from "../../tools/knowledge-base.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeEmbeddingResponse(vector: number[]): unknown {
  return { data: [{ embedding: vector }] };
}

function makeQdrantResponse(
  hits: { title: string; content: string; url: string; spaceKey: string; score: number }[],
): unknown {
  return {
    result: hits.map((h) => ({
      payload: { title: h.title, content: h.content, url: h.url, spaceKey: h.spaceKey },
      score: h.score,
    })),
  };
}

const baseConfig = {
  qdrantUrl: "http://qdrant:6333",
  collectionName: "docs",
  embeddingApiKey: "test-key",
  embeddingModel: "text-embedding-3-small",
  embeddingProvider: "openai" as const,
};

const queryVector = [0.1, 0.2, 0.3];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createKnowledgeBaseTool", () => {
  describe("OpenAI provider", () => {
    it("calls OpenAI embeddings endpoint with correct body", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeJsonResponse(makeEmbeddingResponse(queryVector)))
        .mockResolvedValueOnce(makeJsonResponse(makeQdrantResponse([])));

      const tool = createKnowledgeBaseTool(baseConfig);
      await tool.execute({ query: "test query", limit: 5 });

      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/embeddings");
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body.model).toBe("text-embedding-3-small");
      expect(body.input).toBe("test query");
      expect(body.input_type).toBeUndefined();
    });
  });

  describe("Voyage provider", () => {
    it("calls Voyage embeddings endpoint and adds input_type=query", async () => {
      const voyageConfig = { ...baseConfig, embeddingProvider: "voyage" as const };
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeJsonResponse(makeEmbeddingResponse(queryVector)))
        .mockResolvedValueOnce(makeJsonResponse(makeQdrantResponse([])));

      const tool = createKnowledgeBaseTool(voyageConfig);
      await tool.execute({ query: "my query" });

      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe("https://api.voyageai.com/v1/embeddings");
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body.input_type).toBe("query");
    });
  });

  describe("Qdrant filter", () => {
    it("adds spaceKey filter when provided", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeJsonResponse(makeEmbeddingResponse(queryVector)))
        .mockResolvedValueOnce(makeJsonResponse(makeQdrantResponse([])));

      const tool = createKnowledgeBaseTool(baseConfig);
      await tool.execute({ query: "q", spaceKey: "IT" });

      const [, init] = vi.mocked(fetch).mock.calls[1]!;
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body.filter).toEqual({
        must: [{ key: "spaceKey", match: { value: "IT" } }],
      });
    });

    it("omits filter when spaceKey is not provided", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeJsonResponse(makeEmbeddingResponse(queryVector)))
        .mockResolvedValueOnce(makeJsonResponse(makeQdrantResponse([])));

      const tool = createKnowledgeBaseTool(baseConfig);
      await tool.execute({ query: "q" });

      const [, init] = vi.mocked(fetch).mock.calls[1]!;
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body.filter).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("throws when embedding API fails", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

      const tool = createKnowledgeBaseTool(baseConfig);
      await expect(tool.execute({ query: "q" })).rejects.toThrow("Embedding API failed");
    });

    it("throws when Qdrant search fails", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeJsonResponse(makeEmbeddingResponse(queryVector)))
        .mockResolvedValueOnce(new Response("Internal Error", { status: 500 }));

      const tool = createKnowledgeBaseTool(baseConfig);
      await expect(tool.execute({ query: "q" })).rejects.toThrow("Qdrant search failed");
    });
  });

  describe("result mapping", () => {
    it("maps Qdrant hits to SearchResultItems", async () => {
      const hits = [
        {
          title: "Guide",
          content: "Content here",
          url: "http://wiki/guide",
          spaceKey: "IT",
          score: 0.9,
        },
      ];
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeJsonResponse(makeEmbeddingResponse(queryVector)))
        .mockResolvedValueOnce(makeJsonResponse(makeQdrantResponse(hits)));

      const tool = createKnowledgeBaseTool(baseConfig);
      const result = await tool.execute({ query: "guide" });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({
        title: "Guide",
        content: "Content here",
        url: "http://wiki/guide",
        spaceKey: "IT",
        score: 0.9,
      });
      expect(result.totalFound).toBe(1);
    });

    it("returns empty results when no hits", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeJsonResponse(makeEmbeddingResponse(queryVector)))
        .mockResolvedValueOnce(makeJsonResponse(makeQdrantResponse([])));

      const tool = createKnowledgeBaseTool(baseConfig);
      const result = await tool.execute({ query: "q" });

      expect(result.results).toHaveLength(0);
      expect(result.totalFound).toBe(0);
    });
  });
});
