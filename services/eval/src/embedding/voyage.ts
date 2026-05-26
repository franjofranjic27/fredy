import type { EmbeddingConfig, QueryEmbeddingClient } from "./types.js";

export class VoyageQueryEmbedding implements QueryEmbeddingClient {
  private readonly apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl = "https://api.voyageai.com/v1";

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || "voyage-2";
    this.dimensions = config.dimensions ?? 1024;
  }

  async embedQuery(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: [text],
        input_type: "query",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Voyage embedding failed (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data[0].embedding;
  }
}
