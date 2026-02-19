import type { EmbeddingClient, EmbeddingConfig } from "./types.js";

export class VoyageEmbedding implements EmbeddingClient {
  private readonly apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl = "https://api.voyageai.com/v1";

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || "voyage-2";
    this.dimensions = config.dimensions ?? 1024;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        input_type: "document",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Voyage embedding failed: ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map((item) => item.embedding);
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    return embedding;
  }
}
