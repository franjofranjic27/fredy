import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKnowledgeBaseStatsTool } from "../../tools/knowledge-base-stats.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeCollectionInfo(pointsCount: number): unknown {
  return { result: { points_count: pointsCount } };
}

function makeScrollResult(
  spaceKeys: (string | undefined)[],
  nextOffset: string | null = null,
): unknown {
  return {
    result: {
      points: spaceKeys.map((k) => ({ payload: k !== undefined ? { spaceKey: k } : {} })),
      next_page_offset: nextOffset,
    },
  };
}

const config = { qdrantUrl: "http://qdrant:6333", collectionName: "docs" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createKnowledgeBaseStatsTool", () => {
  it("returns status=unavailable when collection fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network error"));

    const tool = createKnowledgeBaseStatsTool(config);
    const result = await tool.execute({});

    expect(result.status).toBe("unavailable");
    expect(result.totalChunks).toBe(0);
    expect(result.spaces).toHaveLength(0);
  });

  it("returns status=unavailable when collection fetch returns non-ok", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    const tool = createKnowledgeBaseStatsTool(config);
    const result = await tool.execute({});

    expect(result.status).toBe("unavailable");
  });

  it("returns status=empty when collection has zero points", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(makeCollectionInfo(0)));

    const tool = createKnowledgeBaseStatsTool(config);
    const result = await tool.execute({});

    expect(result.status).toBe("empty");
    expect(result.totalChunks).toBe(0);
    expect(result.spaces).toHaveLength(0);
  });

  it("aggregates spaceKey counts in a single page", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeJsonResponse(makeCollectionInfo(3)))
      .mockResolvedValueOnce(makeJsonResponse(makeScrollResult(["IT", "IT", "DOCS"])));

    const tool = createKnowledgeBaseStatsTool(config);
    const result = await tool.execute({});

    expect(result.status).toBe("ok");
    expect(result.totalChunks).toBe(3);
    expect(result.spaces).toContainEqual({ spaceKey: "IT", chunkCount: 2 });
    expect(result.spaces).toContainEqual({ spaceKey: "DOCS", chunkCount: 1 });
  });

  it("uses (unknown) for points without spaceKey", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeJsonResponse(makeCollectionInfo(1)))
      .mockResolvedValueOnce(makeJsonResponse(makeScrollResult([undefined])));

    const tool = createKnowledgeBaseStatsTool(config);
    const result = await tool.execute({});

    expect(result.spaces).toContainEqual({ spaceKey: "(unknown)", chunkCount: 1 });
  });

  it("paginates through multiple scroll pages", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeJsonResponse(makeCollectionInfo(4)))
      .mockResolvedValueOnce(makeJsonResponse(makeScrollResult(["IT", "IT"], "cursor_1")))
      .mockResolvedValueOnce(makeJsonResponse(makeScrollResult(["DOCS", "DOCS"], null)));

    const tool = createKnowledgeBaseStatsTool(config);
    const result = await tool.execute({});

    expect(result.spaces).toContainEqual({ spaceKey: "IT", chunkCount: 2 });
    expect(result.spaces).toContainEqual({ spaceKey: "DOCS", chunkCount: 2 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("returns partial results when scroll fails mid-way", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeJsonResponse(makeCollectionInfo(10)))
      .mockResolvedValueOnce(makeJsonResponse(makeScrollResult(["IT", "IT"], "cursor_1")))
      .mockRejectedValueOnce(new Error("scroll failed"));

    const tool = createKnowledgeBaseStatsTool(config);
    const result = await tool.execute({});

    expect(result.status).toBe("ok");
    expect(result.spaces).toContainEqual({ spaceKey: "IT", chunkCount: 2 });
  });

  it("returns partial results when scroll returns non-ok", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeJsonResponse(makeCollectionInfo(5)))
      .mockResolvedValueOnce(makeJsonResponse(makeScrollResult(["IT"], "cursor_1")))
      .mockResolvedValueOnce(new Response("Error", { status: 500 }));

    const tool = createKnowledgeBaseStatsTool(config);
    const result = await tool.execute({});

    expect(result.status).toBe("ok");
    expect(result.spaces).toContainEqual({ spaceKey: "IT", chunkCount: 1 });
  });

  it("sorts spaces by chunkCount descending", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeJsonResponse(makeCollectionInfo(4)))
      .mockResolvedValueOnce(makeJsonResponse(makeScrollResult(["A", "B", "B", "B"])));

    const tool = createKnowledgeBaseStatsTool(config);
    const result = await tool.execute({});

    expect(result.spaces[0]!.spaceKey).toBe("B");
    expect(result.spaces[1]!.spaceKey).toBe("A");
  });

  it("uses the correct collection name in URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(makeCollectionInfo(0)));

    const customConfig = { qdrantUrl: "http://qdrant:6333", collectionName: "my-collection" };
    const tool = createKnowledgeBaseStatsTool(customConfig);
    await tool.execute({});

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://qdrant:6333/collections/my-collection");
  });
});
