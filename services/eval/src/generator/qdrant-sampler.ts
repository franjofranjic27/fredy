import { QdrantClient as QdrantSDK } from "@qdrant/js-client-rest";
import type { SampledChunk, SampledChunkMetadata } from "./types.js";
import { SeededRng } from "./rng.js";

export interface QdrantSamplerConfig {
  readonly url: string;
  readonly collectionName: string;
  readonly apiKey?: string;
}

export interface SampleOptions {
  readonly spaceKey?: string;
}

interface ScrollFilter {
  must: Array<{ key: string; match: { value: string } }>;
}

const SCROLL_PAGE_SIZE = 256;

/**
 * Read-only wrapper around the Qdrant collection. Used by the dataset
 * generator to draw a deterministic sample of chunks from the corpus.
 */
export class QdrantSampler {
  private readonly client: QdrantSDK;
  private readonly collectionName: string;

  constructor(config: QdrantSamplerConfig) {
    this.client = new QdrantSDK({ url: config.url, apiKey: config.apiKey });
    this.collectionName = config.collectionName;
  }

  /**
   * Draw n chunks from the collection.
   *
   * WHY scroll-then-shuffle instead of scroll(limit=n): Qdrant's scroll API
   * returns points in storage order, which is correlated with insertion order.
   * Picking the first n yields chunks from a small number of pages, which is
   * the opposite of what an eval set needs. We therefore page through the full
   * collection (cheap because we exclude vectors) and shuffle with a seeded
   * RNG to keep runs reproducible.
   */
  async sampleChunks(
    n: number,
    rng: SeededRng,
    options: SampleOptions = {},
  ): Promise<SampledChunk[]> {
    const all = await this.scrollAllChunks(options.spaceKey);
    const shuffled = rng.shuffle([...all]);
    return shuffled.slice(0, n);
  }

  /**
   * Return all chunks of a given page, in chunkIndex order.
   */
  async getChunksByPageId(pageId: string): Promise<SampledChunk[]> {
    const chunks: SampledChunk[] = [];
    let offset: number | string | undefined;
    do {
      const response = await this.client.scroll(this.collectionName, {
        limit: SCROLL_PAGE_SIZE,
        offset,
        filter: { must: [{ key: "pageId", match: { value: pageId } }] },
        with_payload: true,
        with_vector: false,
      });
      for (const point of response.points) {
        const chunk = toSampledChunk(point.payload as Record<string, unknown>);
        if (chunk) chunks.push(chunk);
      }
      const next = response.next_page_offset;
      offset = next === null ? undefined : (next as number | string | undefined);
    } while (offset !== undefined);

    return chunks.sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);
  }

  private async scrollAllChunks(spaceKey?: string): Promise<SampledChunk[]> {
    const chunks: SampledChunk[] = [];
    const filter: ScrollFilter | undefined = spaceKey
      ? { must: [{ key: "spaceKey", match: { value: spaceKey } }] }
      : undefined;

    let offset: number | string | undefined;
    do {
      const response = await this.client.scroll(this.collectionName, {
        limit: SCROLL_PAGE_SIZE,
        offset,
        filter,
        with_payload: true,
        with_vector: false,
      });
      for (const point of response.points) {
        const chunk = toSampledChunk(point.payload as Record<string, unknown>);
        if (chunk) chunks.push(chunk);
      }
      const next = response.next_page_offset;
      offset = next === null ? undefined : (next as number | string | undefined);
    } while (offset !== undefined);

    return chunks;
  }
}

function toSampledChunk(payload: Record<string, unknown>): SampledChunk | null {
  const chunkId = payload.chunkId;
  const pageId = payload.pageId;
  const content = payload.content;
  const title = payload.title;
  const spaceKey = payload.spaceKey;
  const chunkIndex = payload.chunkIndex;
  const totalChunks = payload.totalChunks;

  if (
    typeof chunkId !== "string" ||
    typeof pageId !== "string" ||
    typeof content !== "string" ||
    typeof title !== "string" ||
    typeof spaceKey !== "string" ||
    typeof chunkIndex !== "number" ||
    typeof totalChunks !== "number"
  ) {
    return null;
  }

  const headerPath = Array.isArray(payload.headerPath)
    ? (payload.headerPath as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const spaceName = typeof payload.spaceName === "string" ? payload.spaceName : undefined;

  const metadata: SampledChunkMetadata = {
    title,
    spaceKey,
    spaceName,
    headerPath,
    chunkIndex,
    totalChunks,
  };

  return { chunkId, pageId, content, metadata };
}
