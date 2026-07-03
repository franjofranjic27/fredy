import type { EvalCase } from "../dataset/types.js";
import type { QueryEmbeddingClient } from "../embedding/types.js";
import { hitRate, meanReciprocalRank, ndcgAtK, precisionAtK, recallAtK } from "../metrics/index.js";
import type { EvalPgVectorClient } from "../pgvector/client.js";
import type { AggregatedMetrics, EvalReport, PerQueryMetric, PerQueryResult } from "./types.js";

export interface RunnerOptions {
  kValues: number[];
  searchLimit: number;
  scoreThreshold: number;
}

export interface RunnerDeps {
  embedding: QueryEmbeddingClient;
  store: EvalPgVectorClient;
}

export interface RunnerContext {
  vectorTable: string;
  embeddingProvider: string;
  datasetPath: string;
}

export class EvalRunner {
  constructor(
    private readonly deps: RunnerDeps,
    private readonly options: RunnerOptions,
  ) {}

  async run(cases: EvalCase[], context: RunnerContext): Promise<EvalReport> {
    const perQuery: PerQueryResult[] = [];

    for (const c of cases) {
      const result = await this.evaluateCase(c);
      perQuery.push(result);
    }

    return {
      generatedAt: new Date().toISOString(),
      config: {
        vectorTable: context.vectorTable,
        embeddingProvider: context.embeddingProvider,
        embeddingModel: this.deps.embedding.model,
        searchLimit: this.options.searchLimit,
        scoreThreshold: this.options.scoreThreshold,
        kValues: this.options.kValues,
      },
      dataset: {
        path: context.datasetPath,
        queryCount: cases.length,
      },
      aggregated: aggregate(perQuery, this.options.kValues),
      perQuery,
    };
  }

  private async evaluateCase(evalCase: EvalCase): Promise<PerQueryResult> {
    const vector = await this.deps.embedding.embedQuery(evalCase.query);
    const hits = await this.deps.store.search(vector, {
      limit: this.options.searchLimit,
      scoreThreshold: this.options.scoreThreshold,
    });

    const retrievedChunkIds = hits.map((h) => h.chunkId);
    const retrievedScores = hits.map((h) => h.score);

    return {
      queryId: evalCase.queryId,
      query: evalCase.query,
      relevantChunkIds: evalCase.relevantChunkIds,
      retrievedChunkIds,
      retrievedScores,
      metrics: computePerQueryMetrics(
        retrievedChunkIds,
        evalCase.relevantChunkIds,
        this.options.kValues,
      ),
    };
  }
}

function computePerQueryMetrics(
  retrieved: string[],
  relevant: string[],
  kValues: number[],
): PerQueryMetric {
  const precision: Record<string, number> = {};
  const recall: Record<string, number> = {};
  const ndcg: Record<string, number> = {};

  for (const k of kValues) {
    const key = String(k);
    precision[key] = precisionAtK(retrieved, relevant, k);
    recall[key] = recallAtK(retrieved, relevant, k);
    ndcg[key] = ndcgAtK(retrieved, relevant, k);
  }

  return {
    precisionAtK: precision,
    recallAtK: recall,
    ndcgAtK: ndcg,
    hitRate: hitRate(retrieved, relevant),
    reciprocalRank: meanReciprocalRank(retrieved, relevant),
  };
}

function aggregate(results: PerQueryResult[], kValues: number[]): AggregatedMetrics {
  const n = results.length;
  if (n === 0) {
    return {
      precisionAtK: {},
      recallAtK: {},
      ndcgAtK: {},
      hitRate: 0,
      mrr: 0,
    };
  }

  const precision: Record<string, number> = {};
  const recall: Record<string, number> = {};
  const ndcg: Record<string, number> = {};

  for (const k of kValues) {
    const key = String(k);
    precision[key] = mean(results.map((r) => r.metrics.precisionAtK[key]));
    recall[key] = mean(results.map((r) => r.metrics.recallAtK[key]));
    ndcg[key] = mean(results.map((r) => r.metrics.ndcgAtK[key]));
  }

  return {
    precisionAtK: precision,
    recallAtK: recall,
    ndcgAtK: ndcg,
    hitRate: mean(results.map((r) => r.metrics.hitRate)),
    mrr: mean(results.map((r) => r.metrics.reciprocalRank)),
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}
