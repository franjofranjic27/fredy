import { ConfigService } from "@nestjs/config";
import { VoyageEmbeddingService } from "./voyage-embedding.service";
import { LlmError } from "../../llm/llm.types";

function createConfig(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("VoyageEmbeddingService", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws LlmError when no API key configured", async () => {
    const svc = new VoyageEmbeddingService(createConfig({}));
    await expect(svc.embedQuery("hi")).rejects.toBeInstanceOf(LlmError);
  });

  it("sends input_type=query and parses the embedding vector", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.5, 0.5] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const svc = new VoyageEmbeddingService(
      createConfig({
        "embedding.voyage.apiKey": "voy-key",
        "embedding.voyage.model": "voyage-3-lite",
      }),
    );
    const vec = await svc.embedQuery("hello");
    expect(vec).toEqual([0.5, 0.5]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({
      model: "voyage-3-lite",
      input: "hello",
      input_type: "query",
    });
  });
});
