import { z } from "zod";
import type { Tool } from "./types.js";

export interface KnowledgeBaseStatsConfig {
  qdrantUrl: string;
  collectionName: string;
}

interface SpaceStat {
  spaceKey: string;
  chunkCount: number;
}

interface KnowledgeBaseStats {
  collection: string;
  totalChunks: number;
  spaces: SpaceStat[];
  status: "ok" | "empty" | "unavailable";
}

interface QdrantCollectionInfo {
  result: {
    points_count: number;
  };
}

interface QdrantScrollResult {
  result: {
    points: Array<{
      payload: {
        spaceKey?: string;
      };
    }>;
    next_page_offset: string | null;
  };
}

export function createKnowledgeBaseStatsTool(
  config: KnowledgeBaseStatsConfig,
): Tool<Record<string, never>, KnowledgeBaseStats> {
  return {
    name: "get_knowledge_base_stats",
    description: `Get statistics about the knowledge base indexed in Qdrant.
Returns the total number of indexed document chunks and a breakdown by Confluence space.
Use this to understand what content is available before searching, or to verify indexing status.`,
    inputSchema: z.object({}),
    async execute() {
      const baseUrl = `${config.qdrantUrl}/collections/${config.collectionName}`;

      // Fetch collection info for total count
      let totalChunks: number;
      try {
        const collectionResponse = await fetch(baseUrl);
        if (!collectionResponse.ok) {
          return {
            collection: config.collectionName,
            totalChunks: 0,
            spaces: [],
            status: "unavailable",
          };
        }
        const collectionData = (await collectionResponse.json()) as QdrantCollectionInfo;
        totalChunks = collectionData.result.points_count;
      } catch {
        return {
          collection: config.collectionName,
          totalChunks: 0,
          spaces: [],
          status: "unavailable",
        };
      }

      if (totalChunks === 0) {
        return {
          collection: config.collectionName,
          totalChunks: 0,
          spaces: [],
          status: "empty",
        };
      }

      // Paginated scroll to aggregate spaceKey counts
      const spaceCounts = new Map<string, number>();
      let offset: string | null = null;
      const scrollUrl = `${baseUrl}/points/scroll`;

      try {
        do {
          const body: Record<string, unknown> = {
            limit: 100,
            with_payload: ["spaceKey"],
            with_vector: false,
          };
          if (offset !== null) {
            body.offset = offset;
          }

          const scrollResponse = await fetch(scrollUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (!scrollResponse.ok) {
            break;
          }

          const scrollData = (await scrollResponse.json()) as QdrantScrollResult;

          for (const point of scrollData.result.points) {
            const key = point.payload.spaceKey ?? "(unknown)";
            spaceCounts.set(key, (spaceCounts.get(key) ?? 0) + 1);
          }

          offset = scrollData.result.next_page_offset;
        } while (offset !== null);
      } catch {
        // Return what we have even if scroll fails partway
      }

      const spaces: SpaceStat[] = Array.from(spaceCounts.entries())
        .map(([spaceKey, chunkCount]) => ({ spaceKey, chunkCount }))
        .sort((a, b) => b.chunkCount - a.chunkCount);

      return {
        collection: config.collectionName,
        totalChunks,
        spaces,
        status: "ok",
      };
    },
  };
}
