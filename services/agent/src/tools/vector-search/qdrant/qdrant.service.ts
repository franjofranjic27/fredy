import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { VectorSearchHit, VectorSearchOptions, VectorStore } from "../vector-store.interface";

interface QdrantSearchResponse {
  result: Array<{
    id: string | number;
    score: number;
    payload: {
      title?: string;
      content?: string;
      url?: string;
      spaceKey?: string;
    };
  }>;
}

interface QdrantCountResponse {
  result: { count: number };
}

@Injectable()
export class QdrantService implements VectorStore {
  readonly providerId = "qdrant";
  readonly collectionName: string;
  private readonly logger = new Logger(QdrantService.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>("qdrant.url") ?? "http://localhost:6333").replace(/\/$/, "");
    this.collectionName = config.get<string>("qdrant.collection") ?? "confluence-pages";
  }

  async search(vector: number[], options: VectorSearchOptions): Promise<VectorSearchHit[]> {
    const body: Record<string, unknown> = {
      vector,
      limit: options.limit,
      with_payload: true,
    };
    if (typeof options.scoreThreshold === "number") {
      body.score_threshold = options.scoreThreshold;
    }
    if (options.filter) {
      body.filter = options.filter;
    }

    const response = await fetch(
      `${this.baseUrl}/collections/${this.collectionName}/points/search`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Qdrant search failed (${response.status}): ${text}`);
      throw new Error(`Qdrant search failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as QdrantSearchResponse;
    return payload.result.map((hit) => ({
      id: hit.id,
      score: hit.score,
      payload: {
        title: hit.payload.title,
        content: hit.payload.content ?? "",
        url: hit.payload.url,
        spaceKey: hit.payload.spaceKey,
      },
    }));
  }

  async count(): Promise<number> {
    const response = await fetch(
      `${this.baseUrl}/collections/${this.collectionName}/points/count`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exact: true }),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Qdrant count failed: ${response.status} ${text}`);
    }
    const payload = (await response.json()) as QdrantCountResponse;
    return payload.result.count;
  }
}
