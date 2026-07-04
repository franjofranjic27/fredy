import type { RerankCandidate, RerankedResult, Reranker } from "./reranker.js";

const DEFAULT_BASE_URL = "https://api.cohere.com/v2";

interface CohereRerankResponse {
  results: Array<{ index: number; relevance_score: number }>;
}

export interface CohereRerankerOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

/** Mirrors services/eval/src/rag_eval/rerank/cohere.py (POST /v2/rerank). */
export function createCohereReranker(options: CohereRerankerOptions): Reranker {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

  return {
    provider: "cohere",
    model: options.model,
    async rerank(
      query: string,
      candidates: readonly RerankCandidate[],
      topN: number,
    ): Promise<RerankedResult[]> {
      if (candidates.length === 0) return [];
      const response = await fetchImpl(`${baseUrl}/rerank`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          query,
          documents: candidates.map((candidate) => candidate.content),
          top_n: topN,
        }),
      });
      if (!response.ok) {
        throw new Error(`Cohere rerank failed: ${response.status}`);
      }
      const data = (await response.json()) as CohereRerankResponse;
      return data.results.map((result) => ({
        id: candidates[result.index].id,
        score: result.relevance_score,
      }));
    },
  };
}
