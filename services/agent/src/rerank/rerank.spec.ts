import { describe, expect, it, vi } from "vitest";
import { createCohereReranker } from "./cohere.js";
import { createVoyageReranker } from "./voyage.js";
import { createReranker } from "./factory.js";
import type { RerankCandidate } from "./reranker.js";

const candidates: RerankCandidate[] = [
  { id: "a", content: "content a" },
  { id: "b", content: "content b" },
];

function fetchReturning(payload: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  }) as unknown as typeof fetch;
}

describe("createCohereReranker", () => {
  it("POSTs to /v2/rerank with model, query, documents and top_n", async () => {
    const fetchImpl = fetchReturning({
      results: [
        { index: 1, relevance_score: 0.95 },
        { index: 0, relevance_score: 0.4 },
      ],
    });
    const reranker = createCohereReranker({ apiKey: "key", model: "rerank-v3.5", fetchImpl });
    const results = await reranker.rerank("vpn", candidates, 10);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.cohere.com/v2/rerank",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
      }),
    );
    const body = JSON.parse((vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      model: "rerank-v3.5",
      query: "vpn",
      documents: ["content a", "content b"],
      top_n: 10,
    });
    expect(results).toEqual([
      { id: "b", score: 0.95 },
      { id: "a", score: 0.4 },
    ]);
  });

  it("short-circuits on empty candidates", async () => {
    const fetchImpl = fetchReturning({});
    const reranker = createCohereReranker({ apiKey: "key", model: "m", fetchImpl });
    expect(await reranker.rerank("q", [], 5)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws with the status on API errors", async () => {
    const fetchImpl = fetchReturning({}, false, 429);
    const reranker = createCohereReranker({ apiKey: "key", model: "m", fetchImpl });
    await expect(reranker.rerank("q", candidates, 5)).rejects.toThrow("Cohere rerank failed: 429");
  });
});

describe("createVoyageReranker", () => {
  it("POSTs to /v1/rerank with top_k and maps the data array", async () => {
    const fetchImpl = fetchReturning({
      data: [{ index: 0, relevance_score: 0.8 }],
    });
    const reranker = createVoyageReranker({ apiKey: "vkey", model: "rerank-2.5", fetchImpl });
    const results = await reranker.rerank("vpn", candidates, 3);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/rerank",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      model: "rerank-2.5",
      query: "vpn",
      documents: ["content a", "content b"],
      top_k: 3,
    });
    expect(results).toEqual([{ id: "a", score: 0.8 }]);
  });

  it("throws with the status on API errors", async () => {
    const fetchImpl = fetchReturning({}, false, 500);
    const reranker = createVoyageReranker({ apiKey: "vkey", model: "m", fetchImpl });
    await expect(reranker.rerank("q", candidates, 5)).rejects.toThrow("Voyage rerank failed: 500");
  });
});

describe("createReranker factory", () => {
  it("returns null for provider none", () => {
    expect(createReranker({ provider: "none", topN: 10, threshold: 0 })).toBeNull();
  });

  it("builds the provider-specific reranker", () => {
    const cohere = createReranker({
      provider: "cohere",
      apiKey: "k",
      model: "rerank-v3.5",
      topN: 10,
      threshold: 0,
    });
    expect(cohere?.provider).toBe("cohere");
    const voyage = createReranker({
      provider: "voyage",
      apiKey: "k",
      model: "rerank-2.5",
      topN: 10,
      threshold: 0,
    });
    expect(voyage?.provider).toBe("voyage");
  });

  it("fails fast without an API key", () => {
    expect(() =>
      createReranker({ provider: "cohere", model: "m", topN: 10, threshold: 0 }),
    ).toThrow('RERANK_API_KEY is required when RERANKER is "cohere"');
  });
});
