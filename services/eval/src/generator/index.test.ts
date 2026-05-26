import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnthropicClient } from "./anthropic-client.js";
import type { QdrantSampler } from "./qdrant-sampler.js";
import type { SampledChunk } from "./types.js";
import { formatQueryId, generateDataset } from "./index.js";
import { SeededRng } from "./rng.js";

function chunk(pageId: string, idx: number, total = 2, content = "content"): SampledChunk {
  return {
    chunkId: `${pageId}_${idx}`,
    pageId,
    content: `${content} ${pageId}/${idx}`,
    metadata: {
      title: `Page ${pageId}`,
      spaceKey: "DOCS",
      spaceName: "Docs",
      headerPath: ["Section"],
      chunkIndex: idx,
      totalChunks: total,
    },
  };
}

function makeSamplerMock(corpus: SampledChunk[]): QdrantSampler {
  const byPage = new Map<string, SampledChunk[]>();
  for (const c of corpus) {
    const list = byPage.get(c.pageId) ?? [];
    list.push(c);
    byPage.set(c.pageId, list);
  }

  return {
    sampleChunks: vi.fn(async (n: number, rng: SeededRng) => {
      const shuffled = rng.shuffle([...corpus]);
      return shuffled.slice(0, n);
    }),
    getChunksByPageId: vi.fn(async (pageId: string) =>
      [...(byPage.get(pageId) ?? [])].sort(
        (a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex,
      ),
    ),
  } as unknown as QdrantSampler;
}

function makeLlmMock(): AnthropicClient {
  return {
    modelName: "claude-opus-4-7",
    generateQuestion: vi.fn(async (content: string) => ({
      question: `Q for ${content}`,
      rationale: "because",
    })),
    verifyRelevance: vi.fn(async () => true),
  } as unknown as AnthropicClient;
}

describe("formatQueryId", () => {
  it("zero-pads to three digits", () => {
    expect(formatQueryId(1)).toBe("q_001");
    expect(formatQueryId(42)).toBe("q_042");
    expect(formatQueryId(123)).toBe("q_123");
  });

  it("does not truncate above 999", () => {
    expect(formatQueryId(1000)).toBe("q_1000");
  });
});

describe("generateDataset", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "eval-gen-"));
  });

  it("writes one record per sampled chunk", async () => {
    const corpus = [chunk("p1", 0), chunk("p1", 1), chunk("p2", 0)];
    const sampler = makeSamplerMock(corpus);
    const llm = makeLlmMock();
    const outputPath = join(outDir, "out.jsonl");

    const records = await generateDataset(
      { count: 2, outputPath, seed: 1, concurrency: 2 },
      { sampler, llm },
    );

    expect(records).toHaveLength(2);
    const content = await readFile(outputPath, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
  });

  it("assigns stable zero-padded queryIds", async () => {
    const corpus = [chunk("p1", 0), chunk("p2", 0), chunk("p3", 0)];
    const records = await generateDataset(
      { count: 3, outputPath: join(outDir, "x.jsonl"), seed: 1, concurrency: 1 },
      { sampler: makeSamplerMock(corpus), llm: makeLlmMock() },
    );

    expect(records.map((r) => r.queryId)).toEqual(["q_001", "q_002", "q_003"]);
  });

  it("is deterministic given the same seed", async () => {
    const corpus = Array.from({ length: 20 }, (_, i) => chunk(`p${i}`, 0));

    const run1 = await generateDataset(
      { count: 5, outputPath: join(outDir, "a.jsonl"), seed: 7, concurrency: 4 },
      { sampler: makeSamplerMock(corpus), llm: makeLlmMock() },
    );
    const run2 = await generateDataset(
      { count: 5, outputPath: join(outDir, "b.jsonl"), seed: 7, concurrency: 4 },
      { sampler: makeSamplerMock(corpus), llm: makeLlmMock() },
    );

    expect(run1.map((r) => r.metadata.sourcePageId)).toEqual(
      run2.map((r) => r.metadata.sourcePageId),
    );
  });

  it("includes same-page neighbour chunks in relevantChunkIds", async () => {
    const corpus = [chunk("p1", 0), chunk("p1", 1), chunk("p1", 2), chunk("p2", 0)];
    const sampler = {
      sampleChunks: vi.fn(async () => [corpus[0]]),
      getChunksByPageId: vi.fn(async () => [corpus[0], corpus[1], corpus[2]]),
    } as unknown as QdrantSampler;

    const records = await generateDataset(
      { count: 1, outputPath: join(outDir, "n.jsonl"), seed: 1, concurrency: 1 },
      { sampler, llm: makeLlmMock() },
    );

    expect(records[0].relevantChunkIds).toContain("p1_0");
    expect(records[0].relevantChunkIds).toContain("p1_1");
    expect(records[0].relevantChunkIds).toContain("p1_2");
    expect(records[0].relevantChunkIds[0]).toBe("p1_0");
  });

  it("skips chunks when the LLM fails but completes the rest of the run", async () => {
    const corpus = [chunk("p1", 0), chunk("p2", 0), chunk("p3", 0)];
    const sampler = makeSamplerMock(corpus);
    const llm = {
      modelName: "claude-opus-4-7",
      generateQuestion: vi
        .fn()
        .mockResolvedValueOnce({ question: "Q1", rationale: "r" })
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ question: "Q3", rationale: "r" }),
      verifyRelevance: vi.fn(),
    } as unknown as AnthropicClient;

    const progress = vi.fn();
    const records = await generateDataset(
      { count: 3, outputPath: join(outDir, "skip.jsonl"), seed: 1, concurrency: 1 },
      { sampler, llm, onProgress: progress },
    );

    expect(records).toHaveLength(2);
    const skippedCalls = progress.mock.calls
      .map((c) => c[0])
      .filter((e: { status: string }) => e.status === "skipped");
    expect(skippedCalls).toHaveLength(1);
  });

  it("verifies neighbours when verifyNeighbours is enabled", async () => {
    const corpus = [chunk("p1", 0), chunk("p1", 1), chunk("p1", 2)];
    const sampler = {
      sampleChunks: vi.fn(async () => [corpus[0]]),
      getChunksByPageId: vi.fn(async () => corpus),
    } as unknown as QdrantSampler;

    const verifyRelevance = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const llm = {
      modelName: "claude-opus-4-7",
      generateQuestion: vi.fn(async () => ({ question: "Q", rationale: "r" })),
      verifyRelevance,
    } as unknown as AnthropicClient;

    const records = await generateDataset(
      { count: 1, outputPath: join(outDir, "v.jsonl"), seed: 1, concurrency: 1 },
      { sampler, llm, verifyNeighbours: true },
    );

    expect(verifyRelevance).toHaveBeenCalledTimes(2);
    expect(records[0].relevantChunkIds).toEqual(["p1_0", "p1_1"]);
  });

  it("emits progress events for every chunk", async () => {
    const corpus = [chunk("p1", 0), chunk("p2", 0)];
    const progress = vi.fn();

    await generateDataset(
      { count: 2, outputPath: join(outDir, "p.jsonl"), seed: 1, concurrency: 1 },
      { sampler: makeSamplerMock(corpus), llm: makeLlmMock(), onProgress: progress },
    );

    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls[0][0]).toMatchObject({ index: 1, total: 2, status: "ok" });
  });
});
