import { describe, it, expect } from "vitest";
import { chunkHtmlContent } from "../../chunking/html-chunker.js";
import type { ChunkingOptions } from "../../chunking/types.js";
import type { PageMetadata } from "../../confluence/types.js";

const baseMetadata: PageMetadata = {
  pageId: "page-1",
  title: "Test Page",
  spaceKey: "IT",
  spaceName: "IT Space",
  labels: [],
  author: "test-user",
  lastModified: "2024-01-01T00:00:00.000Z",
  version: 1,
  url: "https://example.com/wiki/page-1",
  ancestors: [],
};

const defaultOptions: ChunkingOptions = {
  maxTokens: 800,
  overlapTokens: 50,
  preserveCodeBlocks: true,
  preserveTables: true,
};

describe("chunkHtmlContent", () => {
  it("returns empty array for empty HTML", () => {
    const chunks = chunkHtmlContent("", baseMetadata, defaultOptions);
    expect(chunks).toHaveLength(0);
  });

  it("returns empty array for whitespace-only HTML", () => {
    const chunks = chunkHtmlContent("   \n  ", baseMetadata, defaultOptions);
    expect(chunks).toHaveLength(0);
  });

  it("creates one chunk for a simple paragraph", () => {
    const html = "<p>Hello world, this is a test paragraph.</p>";
    const chunks = chunkHtmlContent(html, baseMetadata, defaultOptions);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Hello world");
  });

  it("splits content on headers into separate sections", () => {
    const html = `
      <p>Intro text</p>
      <h2>Section One</h2>
      <p>Content of section one.</p>
      <h2>Section Two</h2>
      <p>Content of section two.</p>
    `;
    const chunks = chunkHtmlContent(html, baseMetadata, defaultOptions);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const sectionOneChunk = chunks.find((c) => c.content.includes("Content of section one"));
    const sectionTwoChunk = chunks.find((c) => c.content.includes("Content of section two"));
    expect(sectionOneChunk).toBeDefined();
    expect(sectionTwoChunk).toBeDefined();
  });

  it("splits large sections into multiple chunks", () => {
    // Create content that exceeds maxTokens (800 * 4 chars ≈ 3200 chars)
    const longParagraph = "word ".repeat(400); // ~2000 chars, ~500 tokens per para
    const html = `
      <h2>Big Section</h2>
      <p>${longParagraph}</p>
      <p>${longParagraph}</p>
      <p>${longParagraph}</p>
    `;
    const tightOptions: ChunkingOptions = { ...defaultOptions, maxTokens: 200 };
    const chunks = chunkHtmlContent(html, baseMetadata, tightOptions);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("detects code content type for pre/code blocks", () => {
    const html = `
      <h2>Code Section</h2>
      <pre><code>const x = 1;\nconst y = 2;</code></pre>
    `;
    const chunks = chunkHtmlContent(html, baseMetadata, defaultOptions);
    expect(chunks.length).toBeGreaterThan(0);
    const codeChunk = chunks.find((c) => c.metadata.contentType === "code");
    expect(codeChunk).toBeDefined();
  });

  it("detects table content type for table elements", () => {
    const html = `
      <h2>Data Table</h2>
      <table>
        <tr><th>Name</th><th>Value</th></tr>
        <tr><td>foo</td><td>bar</td></tr>
      </table>
    `;
    const chunks = chunkHtmlContent(html, baseMetadata, defaultOptions);
    const tableChunk = chunks.find((c) => c.metadata.contentType === "table");
    expect(tableChunk).toBeDefined();
  });

  it("includes page title in the context prefix", () => {
    const html = "<p>Some content here.</p>";
    const chunks = chunkHtmlContent(html, baseMetadata, defaultOptions);
    expect(chunks[0].content).toContain("Test Page");
  });

  it("includes ancestor path in the context prefix", () => {
    const metaWithAncestors: PageMetadata = {
      ...baseMetadata,
      ancestors: ["Parent", "Grandparent"],
    };
    const html = "<p>Content</p>";
    const chunks = chunkHtmlContent(html, metaWithAncestors, defaultOptions);
    expect(chunks[0].content).toContain("Parent");
    expect(chunks[0].content).toContain("Grandparent");
  });

  it("assigns sequential chunk indices", () => {
    const longParagraph = "word ".repeat(400);
    const html = `
      <p>${longParagraph}</p>
      <p>${longParagraph}</p>
      <p>${longParagraph}</p>
    `;
    const tightOptions: ChunkingOptions = { ...defaultOptions, maxTokens: 200 };
    const chunks = chunkHtmlContent(html, baseMetadata, tightOptions);
    chunks.forEach((chunk, i) => {
      expect(chunk.metadata.chunkIndex).toBe(i);
      expect(chunk.metadata.totalChunks).toBe(chunks.length);
    });
  });
});
