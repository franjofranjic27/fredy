import type { EmbeddingClient, EmbeddingConfig } from "./types.js";

export class OpenAIEmbedding implements EmbeddingClient {
  private readonly apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl = "https://api.openai.com/v1";

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.dimensions = config.dimensions ?? 1536;
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
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
    };
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    return embedding;
  }
}
