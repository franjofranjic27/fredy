import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeJsonl } from "./jsonl-writer.js";
import type { GoldenRecord } from "./types.js";

function makeRecord(id: string): GoldenRecord {
  return {
    queryId: id,
    query: `Frage ${id}`,
    relevantChunkIds: [`${id}_0`],
    source: "synthetic",
    metadata: {
      sourcePageId: id,
      sourcePageTitle: `Title ${id}`,
      sourceSpaceKey: "DOCS",
      generatedBy: "claude-opus-4-7",
      generatedAt: "2026-05-26T12:00:00Z",
    },
  };
}

describe("writeJsonl", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eval-jsonl-"));
  });

  afterEach(async () => {
    // best-effort cleanup, ignore errors in CI
  });

  it("writes one record per line", async () => {
    const path = join(dir, "out.jsonl");
    await writeJsonl(path, [makeRecord("q_001"), makeRecord("q_002")]);

    const content = await readFile(path, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).queryId).toBe("q_001");
    expect(JSON.parse(lines[1]).queryId).toBe("q_002");
  });

  it("creates nested output directories", async () => {
    const path = join(dir, "nested", "deep", "out.jsonl");
    await writeJsonl(path, [makeRecord("q_001")]);
    const content = await readFile(path, "utf8");
    expect(content).toContain("q_001");
  });

  it("writes an empty file for an empty record list", async () => {
    const path = join(dir, "empty.jsonl");
    await writeJsonl(path, []);
    const content = await readFile(path, "utf8");
    expect(content).toBe("");
  });

  it("overwrites an existing file atomically", async () => {
    const path = join(dir, "out.jsonl");
    await writeFile(path, "stale content");
    await writeJsonl(path, [makeRecord("q_001")]);

    const content = await readFile(path, "utf8");
    expect(content).not.toContain("stale");
    expect(content).toContain("q_001");
  });

  it("leaves no leftover .tmp files after a successful write", async () => {
    const path = join(dir, "out.jsonl");
    await writeJsonl(path, [makeRecord("q_001")]);

    const entries = await readdir(dir);
    const leftovers = entries.filter((e) => e.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });
});
