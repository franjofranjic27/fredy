import { withRetry } from "../utils/retry.js";
import type { EmbeddingClient, EmbeddingConfig } from "./types.js";

export class CohereEmbedding implements EmbeddingClient {
  private readonly apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl = "https://api.cohere.com/v2";

  // Cohere's max texts per request
  private static readonly MAX_BATCH = 96;

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || "embed-multilingual-v3.0";
    this.dimensions = config.dimensions ?? 1024;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length > CohereEmbedding.MAX_BATCH) {
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += CohereEmbedding.MAX_BATCH) {
        const batch = texts.slice(i, i + CohereEmbedding.MAX_BATCH);
        const batchResults = await this.embed(batch);
        results.push(...batchResults);
      }
      return results;
    }

    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/embed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          texts,
          input_type: "search_document",
          embedding_types: ["float"],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Cohere embedding failed (${response.status}): ${error}`);
      }

      const data = (await response.json()) as {
        embeddings: { float: number[][] };
      };
      return data.embeddings.float;
    });
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    return embedding;
  }
}
