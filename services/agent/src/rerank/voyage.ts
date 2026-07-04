import type { RerankCandidate, RerankedResult, Reranker } from "./reranker.js";

const DEFAULT_BASE_URL = "https://api.voyageai.com/v1";

interface VoyageRerankResponse {
  data: Array<{ index: number; relevance_score: number }>;
}

export interface VoyageRerankerOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

/** Mirrors services/eval/src/rag_eval/rerank/voyage.py (POST /v1/rerank). */
export function createVoyageReranker(options: VoyageRerankerOptions): Reranker {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

  return {
    provider: "voyage",
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
          top_k: topN,
        }),
      });
      if (!response.ok) {
        throw new Error(`Voyage rerank failed: ${response.status}`);
      }
      const data = (await response.json()) as VoyageRerankResponse;
      return data.data.map((result) => ({
        id: candidates[result.index].id,
        score: result.relevance_score,
      }));
    },
  };
}
