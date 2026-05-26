import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CohereEmbedding } from "../../embeddings/cohere.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cohereResponse(vecs: number[][]): unknown {
  return { embeddings: { float: vecs } };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CohereEmbedding", () => {
  const config = { apiKey: "test-key", model: "embed-multilingual-v3.0" };

  it("returns embeddings for a batch of texts", async () => {
    const vecs = [[0.1, 0.2], [0.3, 0.4]];
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(cohereResponse(vecs)));

    const client = new CohereEmbedding(config);
    const result = await client.embed(["hello", "world"]);

    expect(result).toEqual(vecs);
  });

  it("uses the correct endpoint and headers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeJsonResponse(cohereResponse([[0.1]]))
    );

    const client = new CohereEmbedding(config);
    await client.embed(["test"]);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.cohere.com/v2/embed");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
  });

  it("sends input_type search_document in body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeJsonResponse(cohereResponse([[0.1]]))
    );

    const client = new CohereEmbedding(config);
    await client.embed(["doc"]);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(body.input_type).toBe("search_document");
  });

  it("throws on HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    const client = new CohereEmbedding(config);
    await expect(client.embed(["test"])).rejects.toThrow(
      "Cohere embedding failed (401)"
    );
  });

  it("sub-batches when texts exceed 96", async () => {
    const texts = Array.from({ length: 200 }, (_, i) => `text-${i}`);
    const batchVec = (n: number) => Array.from({ length: n }, () => [0.1]);

    // First call: 96 texts → 96 vectors
    vi.mocked(fetch).mockResolvedValueOnce(
      makeJsonResponse(cohereResponse(batchVec(96)))
    );
    // Second call: remaining 96 texts
    vi.mocked(fetch).mockResolvedValueOnce(
      makeJsonResponse(cohereResponse(batchVec(96)))
    );
    // Third call: remaining 8 texts
    vi.mocked(fetch).mockResolvedValueOnce(
      makeJsonResponse(cohereResponse(batchVec(8)))
    );

    const client = new CohereEmbedding(config);
    const result = await client.embed(texts);

    expect(result).toHaveLength(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("embedSingle returns a single vector", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeJsonResponse(cohereResponse([[0.9, 0.8, 0.7]]))
    );

    const client = new CohereEmbedding(config);
    const vec = await client.embedSingle("single");

    expect(vec).toEqual([0.9, 0.8, 0.7]);
  });

  it("uses default model and dimensions when not provided", () => {
    const client = new CohereEmbedding({ apiKey: "key", model: "" });
    expect(client.model).toBe("embed-multilingual-v3.0");
    expect(client.dimensions).toBe(1024);
  });

  it("respects custom model and dimensions", () => {
    const client = new CohereEmbedding({ apiKey: "key", model: "embed-english-v3.0", dimensions: 512 });
    expect(client.model).toBe("embed-english-v3.0");
    expect(client.dimensions).toBe(512);
  });
});
