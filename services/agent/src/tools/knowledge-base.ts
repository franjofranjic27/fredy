import { z } from "zod";
import type { Tool } from "./types.js";

export interface KnowledgeBaseConfig {
  qdrantUrl: string;
  collectionName: string;
  embeddingApiKey: string;
  embeddingModel: string;
  embeddingProvider: "openai" | "voyage";
}

interface SearchResultItem {
  title: string;
  content: string;
  url: string;
  spaceKey: string;
  score: number;
}

interface QdrantSearchHit {
  payload: {
    title: string;
    content: string;
    url: string;
    spaceKey: string;
  };
  score: number;
}

export function createKnowledgeBaseTool(
  config: KnowledgeBaseConfig
): Tool<
  { query: string; limit?: number; spaceKey?: string },
  { results: SearchResultItem[]; totalFound: number }
> {
  return {
    name: "search_knowledge_base",
    description: `Search the organizational knowledge base (Confluence) for relevant information.
Use this tool when you need to find:
- Documentation and procedures
- Troubleshooting guides
- System configurations
- How-to guides
- Any organizational knowledge

Returns the most relevant document chunks with their source URLs.`,
    inputSchema: z.object({
      query: z
        .string()
        .describe("The search query - be specific and descriptive"),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results to return (default: 5)"),
      spaceKey: z
        .string()
        .optional()
        .describe("Filter to a specific Confluence space (e.g., 'IT', 'DOCS')"),
    }),
    async execute({ query, limit = 5, spaceKey }) {
      // Generate query embedding
      const embeddingUrl =
        config.embeddingProvider === "openai"
          ? "https://api.openai.com/v1/embeddings"
          : "https://api.voyageai.com/v1/embeddings";

      const embeddingBody: Record<string, unknown> = {
        model: config.embeddingModel,
        input: query,
      };

      if (config.embeddingProvider === "voyage") {
        embeddingBody.input_type = "query";
      }

      const embeddingResponse = await fetch(embeddingUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.embeddingApiKey}`,
        },
        body: JSON.stringify(embeddingBody),
      });

      if (!embeddingResponse.ok) {
        const error = await embeddingResponse.text();
        throw new Error(`Embedding API failed: ${error}`);
      }

      const embeddingData = (await embeddingResponse.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      const queryVector = embeddingData.data[0].embedding;

      // Build Qdrant search request
      const searchBody: Record<string, unknown> = {
        vector: queryVector,
        limit,
        with_payload: true,
        score_threshold: 0.7,
      };

      if (spaceKey) {
        searchBody.filter = {
          must: [{ key: "spaceKey", match: { value: spaceKey } }],
        };
      }

      // Search Qdrant
      const searchResponse = await fetch(
        `${config.qdrantUrl}/collections/${config.collectionName}/points/search`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(searchBody),
        }
      );

      if (!searchResponse.ok) {
        const error = await searchResponse.text();
        throw new Error(`Qdrant search failed: ${error}`);
      }

      const searchData = (await searchResponse.json()) as {
        result: QdrantSearchHit[];
      };

      const results: SearchResultItem[] = searchData.result.map((hit) => ({
        title: hit.payload.title,
        content: hit.payload.content,
        url: hit.payload.url,
        spaceKey: hit.payload.spaceKey,
        score: hit.score,
      }));

      return {
        results,
        totalFound: results.length,
      };
    },
  };
}
