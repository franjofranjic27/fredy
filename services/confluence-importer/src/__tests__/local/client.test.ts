import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalFileClient } from "../../local/client.js";
import type { LocalFile } from "../../local/types.js";

describe("LocalFileClient", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fredy-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("getAllFiles", () => {
    it("yields files with matching extensions in the root directory", async () => {
      await writeFile(join(tmpDir, "readme.md"), "# Hello");
      await writeFile(join(tmpDir, "notes.txt"), "Some notes");
      await writeFile(join(tmpDir, "ignored.pdf"), "pdf");

      const client = new LocalFileClient({ directory: tmpDir, extensions: [".md", ".txt"] });
      const files: LocalFile[] = [];
      for await (const file of client.getAllFiles()) files.push(file);

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.extension).sort()).toEqual([".md", ".txt"]);
    });

    it("recurses into subdirectories", async () => {
      await mkdir(join(tmpDir, "sub"), { recursive: true });
      await writeFile(join(tmpDir, "top.md"), "top");
      await writeFile(join(tmpDir, "sub", "nested.md"), "nested");

      const client = new LocalFileClient({ directory: tmpDir, extensions: [".md"] });
      const files: LocalFile[] = [];
      for await (const file of client.getAllFiles()) files.push(file);

      expect(files).toHaveLength(2);
    });

    it("returns empty for a non-existent directory", async () => {
      const client = new LocalFileClient({ directory: "/nonexistent/path", extensions: [".md"] });
      const files: LocalFile[] = [];
      for await (const file of client.getAllFiles()) files.push(file);
      expect(files).toHaveLength(0);
    });

    it("sets correct file metadata fields", async () => {
      await writeFile(join(tmpDir, "doc.md"), "# Content");
      const client = new LocalFileClient({ directory: tmpDir, extensions: [".md"] });
      const files: LocalFile[] = [];
      for await (const file of client.getAllFiles()) files.push(file);

      const file = files[0];
      expect(file.fileName).toBe("doc");
      expect(file.extension).toBe(".md");
      expect(file.content).toBe("# Content");
      expect(file.relativePath).toBe("doc.md");
      expect(file.modifiedAt).toBeInstanceOf(Date);
    });

    it("extension matching is case-insensitive", async () => {
      await writeFile(join(tmpDir, "README.MD"), "content");
      const client = new LocalFileClient({ directory: tmpDir, extensions: [".md"] });
      const files: LocalFile[] = [];
      for await (const file of client.getAllFiles()) files.push(file);
      expect(files).toHaveLength(1);
    });
  });

  describe("extractMetadata", () => {
    it("returns correct metadata for a root-level file", () => {
      const file: LocalFile = {
        filePath: join(tmpDir, "readme.md"),
        relativePath: "readme.md",
        fileName: "readme",
        extension: ".md",
        content: "# Hello",
        modifiedAt: new Date("2024-01-01T00:00:00Z"),
      };

      const client = new LocalFileClient({ directory: tmpDir, extensions: [".md"] });
      const meta = client.extractMetadata(file);

      expect(meta.title).toBe("readme");
      expect(meta.spaceKey).toBe("local");
      expect(meta.spaceName).toBe("Local Files");
      expect(meta.ancestors).toEqual([]);
      expect(meta.url).toBe(`file://${file.filePath}`);
      expect(meta.pageId).toMatch(/^local_/);
      expect(meta.author).toBe("local");
      expect(meta.version).toBe(1);
    });

    it("extracts directory segments as ancestors", () => {
      const file: LocalFile = {
        filePath: join(tmpDir, "docs/guides/setup.md"),
        relativePath: "docs/guides/setup.md",
        fileName: "setup",
        extension: ".md",
        content: "Setup guide",
        modifiedAt: new Date(),
      };

      const client = new LocalFileClient({ directory: tmpDir, extensions: [".md"] });
      expect(client.extractMetadata(file).ancestors).toEqual(["docs", "guides"]);
    });

    it("generates a stable pageId from the relative path", () => {
      const file: LocalFile = {
        filePath: join(tmpDir, "doc.md"),
        relativePath: "doc.md",
        fileName: "doc",
        extension: ".md",
        content: "content",
        modifiedAt: new Date(),
      };

      const client = new LocalFileClient({ directory: tmpDir, extensions: [".md"] });
      expect(client.extractMetadata(file).pageId).toBe(client.extractMetadata(file).pageId);
    });

    it("generates different pageIds for different paths", () => {
      const client = new LocalFileClient({ directory: tmpDir, extensions: [".md"] });
      const makeFile = (rel: string): LocalFile => ({
        filePath: join(tmpDir, rel),
        relativePath: rel,
        fileName: rel,
        extension: ".md",
        content: "",
        modifiedAt: new Date(),
      });

      const id1 = client.extractMetadata(makeFile("a.md")).pageId;
      const id2 = client.extractMetadata(makeFile("b.md")).pageId;
      expect(id1).not.toBe(id2);
    });
  });
});
