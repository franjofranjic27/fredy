import { QdrantClient as QdrantSDK } from "@qdrant/js-client-rest";
import type { Chunk, ChunkMetadata } from "../chunking/types.js";

export interface QdrantConfig {
  url: string;
  collectionName: string;
  apiKey?: string;
  vectorSize: number;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

export class QdrantClient {
  private readonly client: QdrantSDK;
  private readonly collectionName: string;
  private readonly vectorSize: number;

  constructor(config: QdrantConfig) {
    this.client = new QdrantSDK({
      url: config.url,
      apiKey: config.apiKey,
    });
    this.collectionName = config.collectionName;
    this.vectorSize = config.vectorSize;
  }

  /**
   * Initialize collection if it doesn't exist
   */
  async initCollection(): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === this.collectionName
    );

    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorSize,
          distance: "Cosine",
        },
      });

      // Create payload indexes for filtering
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: "spaceKey",
        field_schema: "keyword",
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: "labels",
        field_schema: "keyword",
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: "pageId",
        field_schema: "keyword",
      });

      console.log(`Created collection: ${this.collectionName}`);
    }
  }

  /**
   * Upsert chunks with their embeddings
   */
  async upsertChunks(chunks: Chunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new Error("Chunks and embeddings count mismatch");
    }

    const points = chunks.map((chunk, i) => ({
      id: this.generatePointId(chunk.id),
      vector: embeddings[i],
      payload: {
        chunkId: chunk.id,
        content: chunk.content,
        ...chunk.metadata,
      },
    }));

    // Upsert in batches of 100
    const batchSize = 100;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: batch,
      });
    }
  }

  /**
   * Delete all chunks for a specific page
   */
  async deletePageChunks(pageId: string): Promise<void> {
    await this.client.delete(this.collectionName, {
      wait: true,
      filter: {
        must: [
          {
            key: "pageId",
            match: { value: pageId },
          },
        ],
      },
    });
  }

  /**
   * Search for similar chunks
   */
  async search(
    queryVector: number[],
    options: {
      limit?: number;
      spaceKey?: string;
      labels?: string[];
      scoreThreshold?: number;
    } = {}
  ): Promise<SearchResult[]> {
    const { limit = 5, spaceKey, labels, scoreThreshold = 0.7 } = options;

    const must: Array<Record<string, unknown>> = [];

    if (spaceKey) {
      must.push({
        key: "spaceKey",
        match: { value: spaceKey },
      });
    }

    if (labels?.length) {
      must.push({
        key: "labels",
        match: { any: labels },
      });
    }

    const results = await this.client.search(this.collectionName, {
      vector: queryVector,
      limit,
      filter: must.length > 0 ? { must } : undefined,
      score_threshold: scoreThreshold,
      with_payload: true,
    });

    return results.map((result) => {
      const payload = result.payload as Record<string, unknown>;
      return {
        chunk: {
          id: payload.chunkId as string,
          content: payload.content as string,
          metadata: {
            pageId: payload.pageId,
            title: payload.title,
            spaceKey: payload.spaceKey,
            spaceName: payload.spaceName,
            labels: payload.labels,
            author: payload.author,
            lastModified: payload.lastModified,
            version: payload.version,
            url: payload.url,
            ancestors: payload.ancestors,
            chunkIndex: payload.chunkIndex,
            totalChunks: payload.totalChunks,
            headerPath: payload.headerPath,
            contentType: payload.contentType,
          } as ChunkMetadata,
        },
        score: result.score,
      };
    });
  }

  /**
   * Get collection info
   */
  async getCollectionInfo(): Promise<{
    pointsCount: number;
    indexedVectorsCount: number;
  }> {
    const info = await this.client.getCollection(this.collectionName);
    return {
      pointsCount: info.points_count ?? 0,
      indexedVectorsCount: info.indexed_vectors_count ?? 0,
    };
  }

  /**
   * Generate a numeric point ID from string chunk ID
   */
  private generatePointId(chunkId: string): number {
    // Simple hash function for converting string to number
    let hash = 0;
    for (let i = 0; i < chunkId.length; i++) {
      const char = chunkId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
