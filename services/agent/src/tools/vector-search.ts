import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { EmbeddingClient } from "./embeddings.js";
import type { PgVectorStore, VectorSearchHit } from "./pgvector.js";

export const VECTOR_SEARCH_TOOL_NAME = "vector_search";

export const vectorSearchInputSchema = z.object({
  query: z.string().min(1, "query must not be empty"),
  limit: z.number().int().positive().max(50).optional(),
  spaceKey: z.string().optional(),
});

export type VectorSearchInput = z.infer<typeof vectorSearchInputSchema>;

export interface VectorSearchArtifact {
  hits: VectorSearchHit[];
}

export interface VectorSearchToolDeps {
  readonly embeddings: EmbeddingClient;
  readonly store: PgVectorStore;
  readonly defaultLimit: number;
  readonly scoreThreshold: number;
}

export function formatHit(hit: VectorSearchHit, index: number, score?: number): string {
  const title = hit.payload.title ?? `Result ${index + 1}`;
  const url = hit.payload.url ? `\nSource: ${hit.payload.url}` : "";
  const displayScore = score ?? hit.score;
  return `### ${title} (score=${displayScore.toFixed(3)})${url}\n${hit.payload.content}`;
}

export function formatHits(hits: VectorSearchHit[]): string {
  if (hits.length === 0) return "No relevant documents found.";
  return hits.map((hit, index) => formatHit(hit, index)).join("\n\n---\n\n");
}

/**
 * Semantic search over the knowledge-base chunks. Returns the formatted
 * context as content and the raw hits as artifact (for reranking).
 */
export function createVectorSearchTool(deps: VectorSearchToolDeps) {
  return tool(
    async (input: VectorSearchInput): Promise<[string, VectorSearchArtifact]> => {
      const limit = input.limit ?? deps.defaultLimit;
      const vector = await deps.embeddings.embedQuery(input.query);
      const hits = await deps.store.search(vector, {
        limit,
        scoreThreshold: deps.scoreThreshold,
        spaceKey: input.spaceKey,
      });
      return [formatHits(hits), { hits }];
    },
    {
      name: VECTOR_SEARCH_TOOL_NAME,
      description:
        "Search the organizational knowledge base (Confluence) for relevant document chunks. Returns the most semantically similar chunks with their source URLs.",
      schema: vectorSearchInputSchema,
      responseFormat: "content_and_artifact",
    },
  );
}
