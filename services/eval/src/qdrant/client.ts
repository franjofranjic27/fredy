import { QdrantClient as QdrantSDK } from "@qdrant/js-client-rest";

export interface QdrantConfig {
  url: string;
  collectionName: string;
  apiKey?: string;
}

export interface SearchOptions {
  limit: number;
  scoreThreshold?: number;
  filter?: Record<string, unknown>;
}

export interface SearchHit {
  chunkId: string;
  score: number;
  payload: Record<string, unknown>;
}

/**
 * Read-only Qdrant wrapper for the eval service.
 * WHY: deliberately disjoint from the importer's client to keep eval decoupled
 * and to forbid any write paths (no upsert, no delete, no createCollection).
 */
export class EvalQdrantClient {
  private readonly client: QdrantSDK;
  private readonly collectionName: string;

  constructor(config: QdrantConfig) {
    this.client = new QdrantSDK({
      url: config.url,
      apiKey: config.apiKey,
    });
    this.collectionName = config.collectionName;
  }

  async search(vector: number[], options: SearchOptions): Promise<SearchHit[]> {
    const results = await this.client.search(this.collectionName, {
      vector,
      limit: options.limit,
      score_threshold: options.scoreThreshold,
      filter: options.filter,
      with_payload: true,
    });

    return results.map((result) => {
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const chunkId = extractChunkId(payload);
      return {
        chunkId,
        score: result.score,
        payload,
      };
    });
  }

  async getCollectionInfo(): Promise<{ pointsCount: number }> {
    const info = await this.client.getCollection(this.collectionName);
    return { pointsCount: info.points_count ?? 0 };
  }
}

function extractChunkId(payload: Record<string, unknown>): string {
  const raw = payload.chunkId;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(
      "Qdrant payload is missing required `chunkId` field. " +
        "Ensure the collection was populated by the confluence-importer.",
    );
  }
  return raw;
}
