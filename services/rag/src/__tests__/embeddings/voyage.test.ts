import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VoyageEmbedding } from "../../embeddings/voyage.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function voyageResponse(vecs: number[][]): unknown {
  return { data: vecs.map((embedding) => ({ embedding })) };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VoyageEmbedding", () => {
  const config = { apiKey: "test-key", model: "voyage-3" };

  it("returns embeddings for a batch of texts", async () => {
    const vecs = [
      [0.1, 0.2],
      [0.3, 0.4],
    ];
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(voyageResponse(vecs)));

    const client = new VoyageEmbedding(config);
    const result = await client.embed(["hello", "world"]);

    expect(result).toEqual(vecs);
  });

  it("uses the correct endpoint and headers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(voyageResponse([[0.1]])));

    const client = new VoyageEmbedding(config);
    await client.embed(["test"]);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
  });

  it("sends input_type=document in request body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(voyageResponse([[0.1]])));

    const client = new VoyageEmbedding(config);
    await client.embed(["doc"]);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(body.input_type).toBe("document");
  });

  it("throws on HTTP error with status code in message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const client = new VoyageEmbedding(config);
    await expect(client.embed(["test"])).rejects.toThrow("Voyage embedding failed (401)");
  });

  it("embedSingle returns a single vector", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(voyageResponse([[0.9, 0.8, 0.7]])));

    const client = new VoyageEmbedding(config);
    const vec = await client.embedSingle("single text");

    expect(vec).toEqual([0.9, 0.8, 0.7]);
  });

  it("defaults to voyage-2 model when not provided", () => {
    const client = new VoyageEmbedding({ apiKey: "key", model: "" });
    expect(client.model).toBe("voyage-2");
  });

  it("defaults to 1024 dimensions when not provided", () => {
    const client = new VoyageEmbedding({ apiKey: "key", model: "m" });
    expect(client.dimensions).toBe(1024);
  });

  it("uses custom model and dimensions when provided", () => {
    const client = new VoyageEmbedding({ apiKey: "key", model: "voyage-3", dimensions: 512 });
    expect(client.model).toBe("voyage-3");
    expect(client.dimensions).toBe(512);
  });

  it("sends model and input in request body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(voyageResponse([[0.1]])));

    const client = new VoyageEmbedding({ apiKey: "k", model: "voyage-3" });
    await client.embed(["doc"]);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(body.model).toBe("voyage-3");
    expect(body.input).toEqual(["doc"]);
  });
});
