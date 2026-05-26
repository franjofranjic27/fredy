import type { EmbeddingConfig, QueryEmbeddingClient } from "./types.js";

export class CohereQueryEmbedding implements QueryEmbeddingClient {
  private readonly apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl = "https://api.cohere.com/v2";

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || "embed-multilingual-v3.0";
    this.dimensions = config.dimensions ?? 1024;
  }

  async embedQuery(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        texts: [text],
        input_type: "search_query",
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
    return data.embeddings.float[0];
  }
}
