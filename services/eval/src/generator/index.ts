import type { AnthropicClient } from "./anthropic-client.js";
import type { QdrantSampler } from "./qdrant-sampler.js";
import type { GeneratorConfig, GoldenRecord, SampledChunk } from "./types.js";
import { mapWithConcurrency } from "./concurrency.js";
import { SeededRng } from "./rng.js";
import { writeJsonl } from "./jsonl-writer.js";

export interface ProgressEvent {
  readonly index: number;
  readonly total: number;
  readonly queryId: string;
  readonly status: "ok" | "skipped";
  readonly reason?: string;
}

export type ProgressReporter = (event: ProgressEvent) => void;

export interface GeneratorDeps {
  readonly sampler: QdrantSampler;
  readonly llm: AnthropicClient;
  readonly onProgress?: ProgressReporter;
  /**
   * If true, run a second LLM call per same-page neighbour chunk to confirm
   * relevance. WHY off by default: doubles or triples the cost of a run; the
   * neighbour heuristic ("same pageId answers same question") is good enough
   * for an initial eval set. Turn on for higher-quality datasets.
   */
  readonly verifyNeighbours?: boolean;
}

export async function generateDataset(
  config: GeneratorConfig,
  deps: GeneratorDeps,
): Promise<GoldenRecord[]> {
  const rng = new SeededRng(config.seed);
  const sourceChunks = await deps.sampler.sampleChunks(config.count, rng, {
    spaceKey: config.spaceKey,
  });

  if (sourceChunks.length === 0) {
    await writeJsonl(config.outputPath, []);
    return [];
  }

  const generatedAt = new Date().toISOString();
  const total = sourceChunks.length;

  const results = await mapWithConcurrency(sourceChunks, config.concurrency, async (chunk, i) => {
    const queryId = formatQueryId(i + 1);
    try {
      const record = await buildRecord(chunk, queryId, generatedAt, deps);
      deps.onProgress?.({ index: i + 1, total, queryId, status: "ok" });
      return record;
    } catch (error) {
      deps.onProgress?.({
        index: i + 1,
        total,
        queryId,
        status: "skipped",
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });

  const records = results.filter((r): r is GoldenRecord => r !== null);
  await writeJsonl(config.outputPath, records);
  return records;
}

async function buildRecord(
  chunk: SampledChunk,
  queryId: string,
  generatedAt: string,
  deps: GeneratorDeps,
): Promise<GoldenRecord> {
  const generated = await deps.llm.generateQuestion(chunk.content, {
    title: chunk.metadata.title,
    headerPath: chunk.metadata.headerPath,
  });

  const relevantChunkIds = await collectRelevantChunkIds(chunk, generated.question, deps);

  return {
    queryId,
    query: generated.question,
    relevantChunkIds,
    source: "synthetic",
    metadata: {
      sourcePageId: chunk.pageId,
      sourcePageTitle: chunk.metadata.title,
      sourceSpaceKey: chunk.metadata.spaceKey,
      generatedBy: deps.llm.modelName,
      generatedAt,
    },
  };
}

async function collectRelevantChunkIds(
  source: SampledChunk,
  question: string,
  deps: GeneratorDeps,
): Promise<string[]> {
  const samePage = await deps.sampler.getChunksByPageId(source.pageId);
  const neighbours = samePage.filter((c) => c.chunkId !== source.chunkId);

  if (!deps.verifyNeighbours || neighbours.length === 0) {
    return [source.chunkId, ...neighbours.map((c) => c.chunkId)];
  }

  const verified = await Promise.all(
    neighbours.map(async (n) => ((await deps.llm.verifyRelevance(question, n.content)) ? n : null)),
  );

  return [
    source.chunkId,
    ...verified.filter((n): n is SampledChunk => n !== null).map((n) => n.chunkId),
  ];
}

export function formatQueryId(n: number): string {
  return `q_${n.toString().padStart(3, "0")}`;
}
