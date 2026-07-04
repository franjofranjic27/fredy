import { describe, expect, it, vi } from "vitest";
import { createEmbeddingClient } from "./embeddings.js";

function fetchReturning(payload: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  }) as unknown as typeof fetch;
}

describe("openai embedding client", () => {
  it("POSTs model and input to the default endpoint", async () => {
    const fetchImpl = fetchReturning({ data: [{ embedding: [0.1, 0.2] }] });
    const client = createEmbeddingClient(
      "openai",
      { apiKey: "key", model: "text-embedding-3-small" },
      fetchImpl,
    );
    const vector = await client.embedQuery("hello");

    expect(vector).toEqual([0.1, 0.2]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
      }),
    );
    const body = JSON.parse((vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ model: "text-embedding-3-small", input: "hello" });
  });

  it("uses a custom endpoint when configured", async () => {
    const fetchImpl = fetchReturning({ data: [{ embedding: [1] }] });
    const client = createEmbeddingClient(
      "openai",
      { apiKey: "key", model: "m", endpoint: "https://proxy/emb" },
      fetchImpl,
    );
    await client.embedQuery("x");
    expect(fetchImpl).toHaveBeenCalledWith("https://proxy/emb", expect.anything());
  });

  it("fails with the verbatim missing-key message", async () => {
    const client = createEmbeddingClient("openai", { model: "m" });
    await expect(client.embedQuery("x")).rejects.toThrow(
      "OpenAI embedding key not configured (EMBEDDING_OPENAI_API_KEY missing)",
    );
  });

  it("fails with the status on API errors", async () => {
    const fetchImpl = fetchReturning({}, false, 429);
    const client = createEmbeddingClient("openai", { apiKey: "k", model: "m" }, fetchImpl);
    await expect(client.embedQuery("x")).rejects.toThrow("OpenAI embedding failed: 429");
  });
});

describe("voyage embedding client", () => {
  it("adds input_type query to the request body", async () => {
    const fetchImpl = fetchReturning({ data: [{ embedding: [0.3] }] });
    const client = createEmbeddingClient(
      "voyage",
      { apiKey: "vkey", model: "voyage-3-lite" },
      fetchImpl,
    );
    const vector = await client.embedQuery("hallo");

    expect(vector).toEqual([0.3]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.anything(),
    );
    const body = JSON.parse((vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ model: "voyage-3-lite", input: "hallo", input_type: "query" });
  });

  it("fails with the verbatim missing-key message", async () => {
    const client = createEmbeddingClient("voyage", { model: "m" });
    await expect(client.embedQuery("x")).rejects.toThrow(
      "Voyage embedding key not configured (EMBEDDING_VOYAGE_API_KEY missing)",
    );
  });

  it("fails with the status on API errors", async () => {
    const fetchImpl = fetchReturning({}, false, 500);
    const client = createEmbeddingClient("voyage", { apiKey: "k", model: "m" }, fetchImpl);
    await expect(client.embedQuery("x")).rejects.toThrow("Voyage embedding failed: 500");
  });
});
