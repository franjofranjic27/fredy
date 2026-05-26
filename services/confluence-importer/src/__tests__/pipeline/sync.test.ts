import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { syncConfluence } from "../../pipeline/sync.js";
import type { ChunkingOptions } from "../../chunking/types.js";
import type { ConfluencePage } from "../../confluence/types.js";

function makePage(id: string, title: string): ConfluencePage {
  return {
    id,
    type: "page",
    status: "current",
    title,
    space: { key: "IT", name: "IT Space" },
    body: { storage: { value: `<p>${title}</p>`, representation: "storage" } },
    version: { number: 1, when: "2024-01-01T00:00:00Z", by: { displayName: "Author" } },
    ancestors: [],
    metadata: { labels: { results: [] } },
    _links: { webui: `/wiki/IT/${id}`, self: `/rest/api/content/${id}` },
  };
}

const defaultChunking: ChunkingOptions = {
  maxTokens: 800,
  overlapTokens: 50,
  preserveCodeBlocks: true,
  preserveTables: true,
};

const baseMetadata = {
  pageId: "p1",
  title: "Test",
  spaceKey: "IT",
  spaceName: "IT Space",
  labels: [],
  author: "author",
  lastModified: "2024-01-01T00:00:00Z",
  version: 1,
  url: "https://example.com",
  ancestors: [],
};

describe("syncConfluence", () => {
  let confluence: { getModifiedPages: Mock; shouldIncludePage: Mock; extractMetadata: Mock };
  let embedding: { embed: Mock };
  let qdrant: { deletePageChunks: Mock; upsertChunks: Mock };

  beforeEach(() => {
    confluence = {
      getModifiedPages: vi.fn().mockResolvedValue([]),
      shouldIncludePage: vi.fn().mockReturnValue(true),
      extractMetadata: vi.fn().mockReturnValue(baseMetadata),
    };
    embedding = { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) };
    qdrant = {
      deletePageChunks: vi.fn().mockResolvedValue(undefined),
      upsertChunks: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("returns zero counts when no pages were modified", async () => {
    const result = await syncConfluence(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT"],
      chunkingOptions: defaultChunking,
    });

    expect(result.pagesUpdated).toBe(0);
    expect(result.pagesDeleted).toBe(0);
    expect(result.chunksCreated).toBe(0);
  });

  it("includes a syncTime in the result", async () => {
    const result = await syncConfluence(confluence as any, embedding as any, qdrant as any, {
      spaces: [],
      chunkingOptions: defaultChunking,
    });

    expect(result.syncTime).toBeInstanceOf(Date);
  });

  it("updates a modified page and deletes its old chunks", async () => {
    confluence.getModifiedPages.mockResolvedValue([makePage("p1", "Updated Page")]);

    const result = await syncConfluence(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT"],
      chunkingOptions: defaultChunking,
    });

    expect(result.pagesUpdated).toBe(1);
    expect(qdrant.deletePageChunks).toHaveBeenCalledWith("p1");
  });

  it("deletes chunks for pages now excluded by label filter", async () => {
    confluence.getModifiedPages.mockResolvedValue([makePage("p2", "Excluded Page")]);
    confluence.shouldIncludePage.mockReturnValue(false);

    const result = await syncConfluence(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT"],
      chunkingOptions: defaultChunking,
    });

    expect(result.pagesDeleted).toBe(1);
    expect(result.pagesUpdated).toBe(0);
    expect(qdrant.deletePageChunks).toHaveBeenCalledWith("p2");
  });

  it("syncs pages across multiple spaces", async () => {
    confluence.getModifiedPages
      .mockResolvedValueOnce([makePage("1", "IT Page")])
      .mockResolvedValueOnce([makePage("2", "DOCS Page")]);

    const result = await syncConfluence(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT", "DOCS"],
      chunkingOptions: defaultChunking,
    });

    expect(result.pagesUpdated).toBe(2);
  });

  it("continues syncing after an individual page error", async () => {
    confluence.getModifiedPages.mockResolvedValue([
      makePage("bad", "Failing Page"),
      makePage("good", "Good Page"),
    ]);
    qdrant.deletePageChunks
      .mockRejectedValueOnce(new Error("qdrant error"))
      .mockResolvedValue(undefined);

    await expect(
      syncConfluence(confluence as any, embedding as any, qdrant as any, {
        spaces: ["IT"],
        chunkingOptions: defaultChunking,
      }),
    ).resolves.toBeDefined();
  });

  it("uses a 24-hour default lastSyncTime window", async () => {
    const before = new Date();
    await syncConfluence(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT"],
      chunkingOptions: defaultChunking,
    });

    const [, lastSyncArg] = confluence.getModifiedPages.mock.calls[0] as [string, Date];
    const diffMs = before.getTime() - lastSyncArg.getTime();
    expect(diffMs).toBeGreaterThanOrEqual(23 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
  });
});
