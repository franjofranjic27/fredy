import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { ingestConfluenceToQdrant } from "../../pipeline/ingest.js";
import type { ChunkingOptions } from "../../chunking/types.js";
import type { ConfluencePage } from "../../confluence/types.js";

function makePage(id: string, title: string, labels: string[] = []): ConfluencePage {
  return {
    id,
    type: "page",
    status: "current",
    title,
    space: { key: "IT", name: "IT Space" },
    body: { storage: { value: `<p>${title} content</p>`, representation: "storage" } },
    version: { number: 1, when: "2024-01-01T00:00:00Z", by: { displayName: "Author" } },
    ancestors: [],
    metadata: { labels: { results: labels.map((name) => ({ name, prefix: "global" })) } },
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

describe("ingestConfluenceToQdrant", () => {
  let confluence: { getAllPagesInSpace: Mock; shouldIncludePage: Mock; extractMetadata: Mock };
  let embedding: { embed: Mock };
  let qdrant: { initCollection: Mock; deletePageChunks: Mock; upsertChunks: Mock };

  beforeEach(() => {
    confluence = {
      getAllPagesInSpace: vi.fn(),
      shouldIncludePage: vi.fn().mockReturnValue(true),
      extractMetadata: vi.fn().mockReturnValue(baseMetadata),
    };
    embedding = { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) };
    qdrant = {
      initCollection: vi.fn().mockResolvedValue(undefined),
      deletePageChunks: vi.fn().mockResolvedValue(undefined),
      upsertChunks: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("initialises the collection before processing", async () => {
    async function* empty() {}
    confluence.getAllPagesInSpace.mockReturnValue(empty());

    await ingestConfluenceToQdrant(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT"],
      chunkingOptions: defaultChunking,
    });

    expect(qdrant.initCollection).toHaveBeenCalledOnce();
  });

  it("returns zero counts when no pages exist", async () => {
    async function* empty() {}
    confluence.getAllPagesInSpace.mockReturnValue(empty());

    const result = await ingestConfluenceToQdrant(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT"],
      chunkingOptions: defaultChunking,
    });

    expect(result.pagesProcessed).toBe(0);
    expect(result.pagesSkipped).toBe(0);
    expect(result.chunksCreated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("processes pages from multiple spaces", async () => {
    async function* spaceIT() { yield makePage("1", "IT Page"); }
    async function* spaceDOCS() { yield makePage("2", "DOCS Page"); }
    confluence.getAllPagesInSpace
      .mockReturnValueOnce(spaceIT())
      .mockReturnValueOnce(spaceDOCS());

    const result = await ingestConfluenceToQdrant(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT", "DOCS"],
      chunkingOptions: defaultChunking,
    });

    expect(result.pagesProcessed).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("skips pages that fail the label filter", async () => {
    async function* pages() { yield makePage("1", "Draft Page", ["draft"]); }
    confluence.getAllPagesInSpace.mockReturnValue(pages());
    confluence.shouldIncludePage.mockReturnValue(false);

    const result = await ingestConfluenceToQdrant(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT"],
      chunkingOptions: defaultChunking,
    });

    expect(result.pagesSkipped).toBe(1);
    expect(result.pagesProcessed).toBe(0);
    expect(qdrant.deletePageChunks).not.toHaveBeenCalled();
  });

  it("deletes existing chunks for each processed page", async () => {
    async function* pages() { yield makePage("page-42", "A Page"); }
    confluence.getAllPagesInSpace.mockReturnValue(pages());

    await ingestConfluenceToQdrant(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT"],
      chunkingOptions: defaultChunking,
    });

    expect(qdrant.deletePageChunks).toHaveBeenCalledWith("page-42");
  });

  it("records errors without aborting the rest of the run", async () => {
    async function* pages() {
      yield makePage("bad", "Failing Page");
      yield makePage("good", "Good Page");
    }
    confluence.getAllPagesInSpace.mockReturnValue(pages());
    qdrant.deletePageChunks
      .mockRejectedValueOnce(new Error("Qdrant unavailable"))
      .mockResolvedValue(undefined);

    const result = await ingestConfluenceToQdrant(confluence as any, embedding as any, qdrant as any, {
      spaces: ["IT"],
      chunkingOptions: defaultChunking,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].pageId).toBe("bad");
    expect(result.pagesProcessed).toBe(1);
  });
});
