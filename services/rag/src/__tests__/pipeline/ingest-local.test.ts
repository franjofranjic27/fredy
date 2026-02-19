import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { ingestLocalFiles } from "../../pipeline/ingest-local.js";
import type { ChunkingOptions } from "../../chunking/types.js";
import type { LocalFile } from "../../local/types.js";
import type { PageMetadata } from "../../confluence/types.js";

const defaultChunking: ChunkingOptions = {
  maxTokens: 800,
  overlapTokens: 50,
  preserveCodeBlocks: true,
  preserveTables: true,
};

function makeFile(relativePath: string, content = "<p>content</p>"): LocalFile {
  return {
    filePath: `/data/${relativePath}`,
    relativePath,
    fileName: relativePath.split("/").pop()!.replace(/\..+$/, ""),
    extension: ".md",
    content,
    modifiedAt: new Date("2024-01-01"),
  };
}

const baseMeta: PageMetadata = {
  pageId: "local_abc",
  title: "doc",
  spaceKey: "local",
  spaceName: "Local Files",
  labels: [],
  author: "local",
  lastModified: "2024-01-01T00:00:00Z",
  version: 1,
  url: "file:///data/doc.md",
  ancestors: [],
};

describe("ingestLocalFiles", () => {
  let localFiles: { getAllFiles: Mock; extractMetadata: Mock };
  let embedding: { embed: Mock };
  let qdrant: { initCollection: Mock; deletePageChunks: Mock; upsertChunks: Mock };

  beforeEach(() => {
    localFiles = {
      getAllFiles: vi.fn(),
      extractMetadata: vi.fn().mockReturnValue(baseMeta),
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
    localFiles.getAllFiles.mockReturnValue(empty());

    await ingestLocalFiles(localFiles as any, embedding as any, qdrant as any, {
      chunkingOptions: defaultChunking,
    });

    expect(qdrant.initCollection).toHaveBeenCalledOnce();
  });

  it("returns zero counts when no files exist", async () => {
    async function* empty() {}
    localFiles.getAllFiles.mockReturnValue(empty());

    const result = await ingestLocalFiles(localFiles as any, embedding as any, qdrant as any, {
      chunkingOptions: defaultChunking,
    });

    expect(result.filesProcessed).toBe(0);
    expect(result.chunksCreated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("processes each file and counts correctly", async () => {
    async function* files() {
      yield makeFile("doc1.md", "<p>Content one</p>");
      yield makeFile("doc2.md", "<p>Content two</p>");
    }
    localFiles.getAllFiles.mockReturnValue(files());

    const result = await ingestLocalFiles(localFiles as any, embedding as any, qdrant as any, {
      chunkingOptions: defaultChunking,
    });

    expect(result.filesProcessed).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("deletes existing chunks before upserting new ones", async () => {
    async function* files() { yield makeFile("doc.md", "<p>Hello</p>"); }
    localFiles.getAllFiles.mockReturnValue(files());

    await ingestLocalFiles(localFiles as any, embedding as any, qdrant as any, {
      chunkingOptions: defaultChunking,
    });

    expect(qdrant.deletePageChunks).toHaveBeenCalledWith(baseMeta.pageId);
  });

  it("records file errors without aborting the run", async () => {
    async function* files() {
      yield makeFile("bad.md");
      yield makeFile("good.md", "<p>Good content</p>");
    }
    localFiles.getAllFiles.mockReturnValue(files());
    qdrant.deletePageChunks
      .mockRejectedValueOnce(new Error("write error"))
      .mockResolvedValue(undefined);

    const result = await ingestLocalFiles(localFiles as any, embedding as any, qdrant as any, {
      chunkingOptions: defaultChunking,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.filesProcessed).toBe(1);
  });
});
