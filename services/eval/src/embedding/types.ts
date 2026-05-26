export interface QueryEmbeddingClient {
  embedQuery(text: string): Promise<number[]>;
  readonly model: string;
  readonly dimensions?: number;
}

export interface EmbeddingConfig {
  apiKey: string;
  model: string;
  dimensions?: number;
}
