import { describe, expect, it, vi } from "vitest";
import { QdrantSampler } from "./qdrant-sampler.js";
import { SeededRng } from "./rng.js";

interface MockPoint {
  payload: Record<string, unknown>;
}

interface MockScrollResponse {
  points: MockPoint[];
  next_page_offset: number | string | null;
}

function makePayload(pageId: string, idx: number, spaceKey = "DOCS"): Record<string, unknown> {
  return {
    chunkId: `${pageId}_${idx}`,
    pageId,
    content: `content ${pageId}/${idx}`,
    title: `Page ${pageId}`,
    spaceKey,
    spaceName: "Docs",
    headerPath: ["Section"],
    chunkIndex: idx,
    totalChunks: 3,
  };
}

type ScrollImpl = (
  collection: string,
  params: Record<string, unknown>,
) => Promise<MockScrollResponse>;

function makeSampler(
  scrollImpl: ScrollImpl | ((args: unknown) => Promise<MockScrollResponse>),
): QdrantSampler {
  const sampler = new QdrantSampler({ url: "http://localhost:6333", collectionName: "test" });
  const adapted: ScrollImpl = async (collection, params) => {
    const fn = scrollImpl as (a?: unknown, b?: unknown) => Promise<MockScrollResponse>;
    return fn.length >= 2 ? fn(collection, params) : fn(params);
  };
  (sampler as unknown as { client: { scroll: ScrollImpl } }).client = {
    scroll: vi.fn(adapted),
  };
  return sampler;
}

describe("QdrantSampler.sampleChunks", () => {
  it("returns chunks deterministically with the same seed", async () => {
    const payloads = [
      makePayload("p1", 0),
      makePayload("p2", 0),
      makePayload("p3", 0),
      makePayload("p4", 0),
      makePayload("p5", 0),
    ];

    const samplerA = makeSampler(async () => ({
      points: payloads.map((p) => ({ payload: p })),
      next_page_offset: null,
    }));
    const samplerB = makeSampler(async () => ({
      points: payloads.map((p) => ({ payload: p })),
      next_page_offset: null,
    }));

    const a = await samplerA.sampleChunks(3, new SeededRng(42));
    const b = await samplerB.sampleChunks(3, new SeededRng(42));

    expect(a.map((c) => c.chunkId)).toEqual(b.map((c) => c.chunkId));
    expect(a).toHaveLength(3);
  });

  it("respects the requested sample size", async () => {
    const payloads = Array.from({ length: 10 }, (_, i) => makePayload(`p${i}`, 0));
    const sampler = makeSampler(async () => ({
      points: payloads.map((p) => ({ payload: p })),
      next_page_offset: null,
    }));

    const sample = await sampler.sampleChunks(4, new SeededRng(1));
    expect(sample).toHaveLength(4);
  });

  it("filters out invalid payloads silently", async () => {
    const sampler = makeSampler(async () => ({
      points: [
        { payload: makePayload("p1", 0) },
        { payload: { missing: true } },
        { payload: makePayload("p2", 0) },
      ],
      next_page_offset: null,
    }));

    const sample = await sampler.sampleChunks(10, new SeededRng(1));
    expect(sample.map((c) => c.pageId).sort()).toEqual(["p1", "p2"]);
  });

  it("paginates through multiple scroll pages", async () => {
    const scroll = vi
      .fn()
      .mockResolvedValueOnce({
        points: [{ payload: makePayload("p1", 0) }],
        next_page_offset: "cursor",
      })
      .mockResolvedValueOnce({
        points: [{ payload: makePayload("p2", 0) }],
        next_page_offset: null,
      });

    const sampler = makeSampler(scroll);
    const sample = await sampler.sampleChunks(10, new SeededRng(1));

    expect(scroll).toHaveBeenCalledTimes(2);
    expect(sample).toHaveLength(2);
  });

  it("applies a spaceKey filter when provided", async () => {
    const scroll = vi.fn(async (_collection: string, _params: Record<string, unknown>) => ({
      points: [] as MockPoint[],
      next_page_offset: null as number | string | null,
    }));
    const sampler = makeSampler(scroll);

    await sampler.sampleChunks(1, new SeededRng(1), { spaceKey: "OPS" });

    const callArgs = scroll.mock.calls[0][1] as { filter?: { must: unknown[] } };
    expect(callArgs.filter).toEqual({
      must: [{ key: "spaceKey", match: { value: "OPS" } }],
    });
  });
});

describe("QdrantSampler.getChunksByPageId", () => {
  it("returns chunks of a page sorted by chunkIndex", async () => {
    const sampler = makeSampler(async () => ({
      points: [
        { payload: makePayload("p1", 2) },
        { payload: makePayload("p1", 0) },
        { payload: makePayload("p1", 1) },
      ],
      next_page_offset: null,
    }));

    const chunks = await sampler.getChunksByPageId("p1");
    expect(chunks.map((c) => c.metadata.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("applies a pageId filter", async () => {
    const scroll = vi.fn(async (_collection: string, _params: Record<string, unknown>) => ({
      points: [] as MockPoint[],
      next_page_offset: null as number | string | null,
    }));
    const sampler = makeSampler(scroll);

    await sampler.getChunksByPageId("p42");

    const callArgs = scroll.mock.calls[0][1] as { filter?: { must: unknown[] } };
    expect(callArgs.filter).toEqual({
      must: [{ key: "pageId", match: { value: "p42" } }],
    });
  });
});
