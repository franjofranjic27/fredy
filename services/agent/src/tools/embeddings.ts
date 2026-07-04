import type { EmbeddingProvider, EmbeddingProviderConfig } from "../config.js";

export interface EmbeddingClient {
  readonly provider: EmbeddingProvider;
  readonly model: string;
  embedQuery(text: string): Promise<number[]>;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

export type FetchLike = typeof fetch;

const OPENAI_DEFAULT_ENDPOINT = "https://api.openai.com/v1/embeddings";
const VOYAGE_DEFAULT_ENDPOINT = "https://api.voyageai.com/v1/embeddings";

/** A hanging embedding provider must not block requests indefinitely. */
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 15_000;

/**
 * Minimal query-embedding client for the vector_search tool. Voyage requests
 * use input_type "query" to match the importer's document embeddings.
 */
export function createEmbeddingClient(
  provider: EmbeddingProvider,
  config: EmbeddingProviderConfig,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = DEFAULT_EMBEDDING_TIMEOUT_MS,
): EmbeddingClient {
  const endpoint =
    config.endpoint ?? (provider === "openai" ? OPENAI_DEFAULT_ENDPOINT : VOYAGE_DEFAULT_ENDPOINT);

  return {
    provider,
    model: config.model,
    async embedQuery(text: string): Promise<number[]> {
      if (!config.apiKey) {
        throw new Error(
          provider === "openai"
            ? "OpenAI embedding key not configured (EMBEDDING_OPENAI_API_KEY missing)"
            : "Voyage embedding key not configured (EMBEDDING_VOYAGE_API_KEY missing)",
        );
      }
      const body: Record<string, unknown> = { model: config.model, input: text };
      if (provider === "voyage") body.input_type = "query";

      const providerName = provider === "openai" ? "OpenAI" : "Voyage";
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`${providerName} embedding failed: ${response.status}`);
      }
      const payload = (await response.json()) as Partial<EmbeddingResponse>;
      const embedding = payload?.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error(`${providerName} embedding response contained no embedding data`);
      }
      return embedding;
    },
  };
}
