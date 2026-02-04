import type { EmbeddingClient } from "./types.js";
import { OpenAIEmbedding } from "./openai.js";
import { VoyageEmbedding } from "./voyage.js";

export type { EmbeddingClient, EmbeddingConfig } from "./types.js";

export interface CreateEmbeddingClientOptions {
  provider: "openai" | "voyage" | "cohere";
  apiKey: string;
  model: string;
  dimensions?: number;
}

export function createEmbeddingClient(
  options: CreateEmbeddingClientOptions
): EmbeddingClient {
  switch (options.provider) {
    case "openai":
      return new OpenAIEmbedding({
        apiKey: options.apiKey,
        model: options.model,
        dimensions: options.dimensions,
      });

    case "voyage":
      return new VoyageEmbedding({
        apiKey: options.apiKey,
        model: options.model,
        dimensions: options.dimensions,
      });

    case "cohere":
      // TODO: Implement Cohere client
      throw new Error("Cohere embedding not yet implemented");

    default:
      throw new Error(`Unknown embedding provider: ${options.provider}`);
  }
}
