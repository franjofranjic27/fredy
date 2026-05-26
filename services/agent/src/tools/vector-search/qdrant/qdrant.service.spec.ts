import { ConfigService } from "@nestjs/config";
import { QdrantService } from "./qdrant.service";

function createConfig(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("QdrantService", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts to the search endpoint with score threshold and optional filter", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [
            {
              id: "1",
              score: 0.91,
              payload: { title: "VPN", content: "How to VPN", url: "https://x" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const svc = new QdrantService(
      createConfig({
        "qdrant.url": "http://qdrant:6333",
        "qdrant.collection": "confluence-pages",
      }),
    );

    const hits = await svc.search([0.1, 0.2], {
      limit: 5,
      scoreThreshold: 0.7,
      filter: { must: [{ key: "spaceKey", match: { value: "IT" } }] },
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: "1",
      score: 0.91,
      payload: { title: "VPN", content: "How to VPN", url: "https://x" },
    });
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("http://qdrant:6333/collections/confluence-pages/points/search");
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body).toEqual({
      vector: [0.1, 0.2],
      limit: 5,
      with_payload: true,
      score_threshold: 0.7,
      filter: { must: [{ key: "spaceKey", match: { value: "IT" } }] },
    });
  });

  it("throws when Qdrant returns a non-2xx status", async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const svc = new QdrantService(createConfig({}));
    await expect(svc.search([0], { limit: 1 })).rejects.toThrow(/Qdrant search failed/);
  });

  it("counts points via the count endpoint", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { count: 42 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const svc = new QdrantService(createConfig({}));
    await expect(svc.count()).resolves.toBe(42);
  });
});
