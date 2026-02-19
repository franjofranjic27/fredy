import { describe, it, expect } from "vitest";
import { localFileToHtml } from "../../local/chunker.js";

describe("localFileToHtml", () => {
  describe(".html passthrough", () => {
    it("returns HTML content unchanged", () => {
      const html = "<h1>Title</h1><p>Body</p>";
      expect(localFileToHtml(html, ".html")).toBe(html);
    });

    it("is case-insensitive for extension", () => {
      const html = "<p>test</p>";
      expect(localFileToHtml(html, ".HTML")).toBe(html);
    });
  });

  describe(".md conversion", () => {
    it("converts h1–h6 headers", () => {
      const result = localFileToHtml("# H1\n## H2\n### H3", ".md");
      expect(result).toContain("<h1>H1</h1>");
      expect(result).toContain("<h2>H2</h2>");
      expect(result).toContain("<h3>H3</h3>");
    });

    it("wraps regular lines in paragraph tags", () => {
      const result = localFileToHtml("This is a sentence.", ".md");
      expect(result).toContain("<p>This is a sentence.</p>");
    });

    it("skips blank lines", () => {
      const result = localFileToHtml("line1\n\n\nline2", ".md");
      expect(result).toContain("<p>line1</p>");
      expect(result).toContain("<p>line2</p>");
      expect(result).not.toContain("<p></p>");
    });

    it("wraps fenced code blocks in pre/code", () => {
      const md = "```\nconst x = 1;\n```";
      const result = localFileToHtml(md, ".md");
      expect(result).toContain("<pre><code>");
      expect(result).toContain("const x = 1;");
      expect(result).toContain("</code></pre>");
    });

    it("escapes HTML special characters in paragraphs", () => {
      const result = localFileToHtml("a < b & c > d", ".md");
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
      expect(result).toContain("&amp;");
    });

    it("escapes HTML special characters inside code blocks", () => {
      const md = "```\n<div>&amp;</div>\n```";
      const result = localFileToHtml(md, ".md");
      expect(result).toContain("&lt;div&gt;");
    });

    it("closes an unclosed code block at end of input", () => {
      const md = "```\nconst x = 1;";
      const result = localFileToHtml(md, ".md");
      expect(result).toContain("<pre><code>");
      expect(result).toContain("const x = 1;");
    });

    it("handles empty markdown input", () => {
      expect(localFileToHtml("", ".md")).toBe("");
    });
  });

  describe(".txt conversion", () => {
    it("wraps text in a paragraph", () => {
      const result = localFileToHtml("Hello world", ".txt");
      expect(result).toContain("<p>Hello world</p>");
    });

    it("splits on double newlines into multiple paragraphs", () => {
      const result = localFileToHtml("Para one\n\nPara two", ".txt");
      expect(result).toContain("<p>Para one</p>");
      expect(result).toContain("<p>Para two</p>");
    });

    it("trims whitespace from paragraphs", () => {
      const result = localFileToHtml("  trimmed  \n\n  also trimmed  ", ".txt");
      expect(result).toContain("<p>trimmed</p>");
      expect(result).toContain("<p>also trimmed</p>");
    });
  });

  describe("unknown extension fallback", () => {
    it("falls back to text conversion for unknown extensions", () => {
      const result = localFileToHtml("content here", ".rst");
      expect(result).toContain("<p>content here</p>");
    });
  });
});
