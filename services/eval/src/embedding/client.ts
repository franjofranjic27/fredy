import { CohereQueryEmbedding } from "./cohere.js";
import { OpenAIQueryEmbedding } from "./openai.js";
import { VoyageQueryEmbedding } from "./voyage.js";
import type { EmbeddingConfig, QueryEmbeddingClient } from "./types.js";

export type EmbeddingProvider = "openai" | "voyage" | "cohere";

export interface EmbeddingClientFactoryInput extends EmbeddingConfig {
  provider: EmbeddingProvider;
}

export function createEmbeddingClient(input: EmbeddingClientFactoryInput): QueryEmbeddingClient {
  const { provider, ...config } = input;
  switch (provider) {
    case "openai":
      return new OpenAIQueryEmbedding(config);
    case "voyage":
      return new VoyageQueryEmbedding(config);
    case "cohere":
      return new CohereQueryEmbedding(config);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported embedding provider: ${exhaustive as string}`);
    }
  }
}
