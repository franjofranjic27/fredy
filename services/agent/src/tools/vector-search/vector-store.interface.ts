export interface VectorSearchFilter {
  spaceKey?: string;
}

export interface VectorSearchOptions {
  limit: number;
  scoreThreshold?: number;
  filter?: VectorSearchFilter;
}

export interface VectorSearchHit {
  id: string | number;
  score: number;
  payload: {
    title?: string;
    content: string;
    url?: string;
    spaceKey?: string;
  };
}

export interface VectorStore {
  readonly providerId: string;
  readonly collectionName: string;
  search(vector: number[], options: VectorSearchOptions): Promise<VectorSearchHit[]>;
  count(): Promise<number>;
}

export const VECTOR_STORE = Symbol("VECTOR_STORE");
