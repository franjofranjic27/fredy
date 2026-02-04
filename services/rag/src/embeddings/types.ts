export interface EmbeddingClient {
  /**
   * Generate embeddings for a batch of texts
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Generate embedding for a single text
   */
  embedSingle(text: string): Promise<number[]>;

  /**
   * Get the dimension of embeddings produced by this client
   */
  readonly dimensions: number;

  /**
   * Get the model name
   */
  readonly model: string;
}

export interface EmbeddingConfig {
  apiKey: string;
  model: string;
  dimensions?: number;
}
