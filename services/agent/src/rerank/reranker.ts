export interface RerankCandidate {
  readonly id: string;
  readonly content: string;
}

export interface RerankedResult {
  readonly id: string;
  readonly score: number;
}

/** Second-stage ranker over the candidates returned by vector search. */
export interface Reranker {
  readonly provider: "cohere" | "voyage";
  readonly model: string;
  rerank(
    query: string,
    candidates: readonly RerankCandidate[],
    topN: number,
  ): Promise<RerankedResult[]>;
}
