import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSdk = vi.hoisted(() => ({
  getCollections: vi.fn(),
  createCollection: vi.fn(),
  createPayloadIndex: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
  search: vi.fn(),
  getCollection: vi.fn(),
  scroll: vi.fn(),
}));

vi.mock("@qdrant/js-client-rest", () => ({
  // Must use a regular function (not arrow) so it can be invoked with `new`
  QdrantClient: vi.fn(function () { return mockSdk; }),
}));

import { QdrantClient } from "../../qdrant/client.js";
import type { ChunkMetadata } from "../../chunking/types.js";

const defaultConfig = {
  url: "http://localhost:6333",
  collectionName: "test-collection",
  vectorSize: 1536,
};

function makeChunk(id: string) {
  return {
    id,
    content: `content of ${id}`,
    metadata: {
      pageId: "p1",
      title: "Test Page",
      spaceKey: "IT",
      spaceName: "IT Space",
      labels: [],
      author: "author",
      lastModified: "2024-01-01T00:00:00Z",
      version: 1,
      url: "https://example.com",
      ancestors: [],
      chunkIndex: 0,
      totalChunks: 1,
      headerPath: [],
      contentType: "text" as const,
    } satisfies ChunkMetadata,
  };
}

describe("QdrantClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initCollection", () => {
    it("creates the collection when it does not exist", async () => {
      mockSdk.getCollections.mockResolvedValue({ collections: [] });
      mockSdk.createCollection.mockResolvedValue({});
      mockSdk.createPayloadIndex.mockResolvedValue({});

      const client = new QdrantClient(defaultConfig);
      await client.initCollection();

      expect(mockSdk.createCollection).toHaveBeenCalledWith(
        "test-collection",
        expect.objectContaining({ vectors: { size: 1536, distance: "Cosine" } }),
      );
      expect(mockSdk.createPayloadIndex).toHaveBeenCalledTimes(3);
    });

    it("skips creation if the collection already exists", async () => {
      mockSdk.getCollections.mockResolvedValue({ collections: [{ name: "test-collection" }] });

      const client = new QdrantClient(defaultConfig);
      await client.initCollection();

      expect(mockSdk.createCollection).not.toHaveBeenCalled();
    });
  });

  describe("upsertChunks", () => {
    it("throws when chunks and embeddings count mismatch", async () => {
      const client = new QdrantClient(defaultConfig);
      await expect(
        client.upsertChunks([makeChunk("c1")], []),
      ).rejects.toThrow("mismatch");
    });

    it("calls upsert with correct structure", async () => {
      mockSdk.upsert.mockResolvedValue({});
      const client = new QdrantClient(defaultConfig);
      await client.upsertChunks([makeChunk("c1")], [[0.1, 0.2, 0.3]]);

      expect(mockSdk.upsert).toHaveBeenCalledWith(
        "test-collection",
        expect.objectContaining({ wait: true, points: expect.any(Array) }),
      );
      const points = (mockSdk.upsert.mock.calls[0] as [string, { points: unknown[] }])[1].points;
      expect(points).toHaveLength(1);
    });

    it("upserts in batches of 100", async () => {
      mockSdk.upsert.mockResolvedValue({});
      const chunks = Array.from({ length: 250 }, (_, i) => makeChunk(`c${i}`));
      const embeddings = chunks.map(() => [0.1]);

      const client = new QdrantClient(defaultConfig);
      await client.upsertChunks(chunks, embeddings);

      // 250 chunks → 3 batches (100 + 100 + 50)
      expect(mockSdk.upsert).toHaveBeenCalledTimes(3);
    });
  });

  describe("deletePageChunks", () => {
    it("calls delete with the correct pageId filter", async () => {
      mockSdk.delete.mockResolvedValue({});
      const client = new QdrantClient(defaultConfig);
      await client.deletePageChunks("page-99");

      expect(mockSdk.delete).toHaveBeenCalledWith(
        "test-collection",
        expect.objectContaining({
          filter: { must: [{ key: "pageId", match: { value: "page-99" } }] },
        }),
      );
    });
  });

  describe("search", () => {
    it("returns mapped SearchResult objects", async () => {
      mockSdk.search.mockResolvedValue([
        {
          score: 0.95,
          payload: {
            chunkId: "c1",
            content: "result content",
            pageId: "p1",
            title: "Title",
            spaceKey: "IT",
            spaceName: "IT Space",
            labels: [],
            author: "auth",
            lastModified: "2024-01-01",
            version: 1,
            url: "https://x.com",
            ancestors: [],
            chunkIndex: 0,
            totalChunks: 1,
            headerPath: [],
            contentType: "text",
          },
        },
      ]);

      const client = new QdrantClient(defaultConfig);
      const results = await client.search([0.1, 0.2]);

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.95);
      expect(results[0].chunk.id).toBe("c1");
      expect(results[0].chunk.content).toBe("result content");
    });

    it("returns an empty array when there are no results", async () => {
      mockSdk.search.mockResolvedValue([]);
      const client = new QdrantClient(defaultConfig);
      expect(await client.search([0.1])).toHaveLength(0);
    });

    it("applies spaceKey filter when provided", async () => {
      mockSdk.search.mockResolvedValue([]);
      const client = new QdrantClient(defaultConfig);
      await client.search([0.1], { spaceKey: "IT" });

      const callArg = (mockSdk.search.mock.calls[0] as [string, { filter?: unknown }])[1];
      expect(callArg.filter).toBeDefined();
    });
  });

  describe("getCollectionInfo", () => {
    it("returns pointsCount and indexedVectorsCount", async () => {
      mockSdk.getCollection.mockResolvedValue({ points_count: 42, indexed_vectors_count: 40 });
      const client = new QdrantClient(defaultConfig);
      const info = await client.getCollectionInfo();
      expect(info.pointsCount).toBe(42);
      expect(info.indexedVectorsCount).toBe(40);
    });

    it("defaults to 0 when counts are undefined", async () => {
      mockSdk.getCollection.mockResolvedValue({});
      const client = new QdrantClient(defaultConfig);
      const info = await client.getCollectionInfo();
      expect(info.pointsCount).toBe(0);
      expect(info.indexedVectorsCount).toBe(0);
    });
  });

  describe("countBySpace", () => {
    it("aggregates chunk counts per spaceKey", async () => {
      mockSdk.scroll
        .mockResolvedValueOnce({
          points: [
            { payload: { spaceKey: "IT" } },
            { payload: { spaceKey: "IT" } },
            { payload: { spaceKey: "DOCS" } },
          ],
          next_page_offset: null,
        });

      const client = new QdrantClient(defaultConfig);
      const counts = await client.countBySpace();

      expect(counts["IT"]).toBe(2);
      expect(counts["DOCS"]).toBe(1);
    });

    it("handles pagination by following next_page_offset", async () => {
      mockSdk.scroll
        .mockResolvedValueOnce({
          points: [{ payload: { spaceKey: "IT" } }],
          next_page_offset: "cursor-1",
        })
        .mockResolvedValueOnce({
          points: [{ payload: { spaceKey: "IT" } }],
          next_page_offset: null,
        });

      const client = new QdrantClient(defaultConfig);
      const counts = await client.countBySpace();
      expect(counts["IT"]).toBe(2);
      expect(mockSdk.scroll).toHaveBeenCalledTimes(2);
    });
  });

  describe("listStoredPageIds", () => {
    it("returns unique pageIds from the collection", async () => {
      mockSdk.scroll.mockResolvedValue({
        points: [
          { payload: { pageId: "p1" } },
          { payload: { pageId: "p2" } },
          { payload: { pageId: "p1" } }, // duplicate
        ],
        next_page_offset: null,
      });

      const client = new QdrantClient(defaultConfig);
      const ids = await client.listStoredPageIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain("p1");
      expect(ids).toContain("p2");
    });
  });
});
