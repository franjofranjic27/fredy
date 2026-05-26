import { ConfigService } from "@nestjs/config";
import { OpenAIEmbeddingService } from "./openai-embedding.service";
import { LlmError } from "../../llm/llm.types";

function createConfig(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("OpenAIEmbeddingService", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws LlmError when no API key configured", async () => {
    const svc = new OpenAIEmbeddingService(createConfig({}));
    await expect(svc.embedQuery("hi")).rejects.toBeInstanceOf(LlmError);
  });

  it("calls the configured endpoint and returns the embedding vector", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const svc = new OpenAIEmbeddingService(
      createConfig({
        "embedding.openai.apiKey": "sk-test",
        "embedding.openai.model": "text-embedding-3-small",
      }),
    );

    const vec = await svc.embedQuery("the quick brown fox");
    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({ model: "text-embedding-3-small", input: "the quick brown fox" });
  });

  it("maps 429 responses to RATE_LIMITED", async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const svc = new OpenAIEmbeddingService(createConfig({ "embedding.openai.apiKey": "sk-test" }));
    await expect(svc.embedQuery("x")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});
