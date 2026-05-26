export type EmbeddingProviderId = "openai" | "voyage";

export interface EmbeddingClient {
  readonly providerId: EmbeddingProviderId;
  readonly model: string;
  embedQuery(text: string): Promise<number[]>;
}

export const EMBEDDING_CLIENT = Symbol("EMBEDDING_CLIENT");
