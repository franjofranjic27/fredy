import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIEmbedding } from "../../embeddings/openai.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function openAIResponse(vecs: number[][]): unknown {
  return { data: vecs.map((embedding, index) => ({ index, embedding })) };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAIEmbedding", () => {
  const config = { apiKey: "test-key", model: "text-embedding-3-small" };

  it("returns embeddings for a batch of texts", async () => {
    const vecs = [
      [0.1, 0.2],
      [0.3, 0.4],
    ];
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(openAIResponse(vecs)));

    const client = new OpenAIEmbedding(config);
    const result = await client.embed(["hello", "world"]);

    expect(result).toEqual(vecs);
  });

  it("sorts embeddings by index before returning", async () => {
    // Return embeddings in reverse order
    const data = {
      data: [
        { index: 1, embedding: [0.3, 0.4] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(data));

    const client = new OpenAIEmbedding(config);
    const result = await client.embed(["a", "b"]);

    expect(result[0]).toEqual([0.1, 0.2]);
    expect(result[1]).toEqual([0.3, 0.4]);
  });

  it("uses the correct endpoint and headers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(openAIResponse([[0.1]])));

    const client = new OpenAIEmbedding(config);
    await client.embed(["test"]);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
  });

  it("sends model, input, and dimensions in request body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(openAIResponse([[0.1]])));

    const client = new OpenAIEmbedding({
      apiKey: "k",
      model: "text-embedding-3-large",
      dimensions: 512,
    });
    await client.embed(["doc"]);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(body.model).toBe("text-embedding-3-large");
    expect(body.input).toEqual(["doc"]);
    expect(body.dimensions).toBe(512);
  });

  it("throws on HTTP error with status code in message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const client = new OpenAIEmbedding(config);
    await expect(client.embed(["test"])).rejects.toThrow("OpenAI embedding failed (401)");
  });

  it("sub-batches when texts exceed 2048", async () => {
    const texts = Array.from({ length: 2049 }, (_, i) => `text-${i}`);
    const batchVec = (n: number) => Array.from({ length: n }, (_, i) => [i * 0.1]);

    // First batch: 2048 texts
    vi.mocked(fetch).mockResolvedValueOnce(
      makeJsonResponse({ data: batchVec(2048).map((embedding, index) => ({ index, embedding })) }),
    );
    // Second batch: 1 remaining text
    vi.mocked(fetch).mockResolvedValueOnce(
      makeJsonResponse({ data: [{ index: 0, embedding: [0.5] }] }),
    );

    const client = new OpenAIEmbedding(config);
    const result = await client.embed(texts);

    expect(result).toHaveLength(2049);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("embedSingle returns a single vector", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(openAIResponse([[0.9, 0.8, 0.7]])));

    const client = new OpenAIEmbedding(config);
    const vec = await client.embedSingle("single text");

    expect(vec).toEqual([0.9, 0.8, 0.7]);
  });

  it("defaults to 1536 dimensions when not provided", () => {
    const client = new OpenAIEmbedding({ apiKey: "key", model: "m" });
    expect(client.dimensions).toBe(1536);
  });

  it("uses custom dimensions when provided", () => {
    const client = new OpenAIEmbedding({ apiKey: "key", model: "m", dimensions: 256 });
    expect(client.dimensions).toBe(256);
  });
});
