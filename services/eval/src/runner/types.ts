export interface PerQueryMetric {
  precisionAtK: Record<string, number>;
  recallAtK: Record<string, number>;
  ndcgAtK: Record<string, number>;
  hitRate: number;
  reciprocalRank: number;
}

export interface PerQueryResult {
  queryId: string;
  query: string;
  relevantChunkIds: string[];
  retrievedChunkIds: string[];
  retrievedScores: number[];
  metrics: PerQueryMetric;
}

export interface AggregatedMetrics {
  precisionAtK: Record<string, number>;
  recallAtK: Record<string, number>;
  ndcgAtK: Record<string, number>;
  hitRate: number;
  mrr: number;
}

export interface EvalReport {
  generatedAt: string;
  config: {
    vectorTable: string;
    embeddingProvider: string;
    embeddingModel: string;
    searchLimit: number;
    scoreThreshold: number;
    kValues: number[];
  };
  dataset: {
    path: string;
    queryCount: number;
  };
  aggregated: AggregatedMetrics;
  perQuery: PerQueryResult[];
}
