import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { PgVectorStore } from "./pgvector.js";

export const KNOWLEDGE_BASE_STATS_TOOL_NAME = "get_knowledge_base_stats";

export const knowledgeBaseStatsInputSchema = z.object({}).strict();

export function createKnowledgeBaseStatsTool(store: PgVectorStore) {
  return tool(
    async (): Promise<string> => {
      const count = await store.count();
      return `The knowledge base "${store.collectionName}" currently contains ${count} indexed chunks.`;
    },
    {
      name: KNOWLEDGE_BASE_STATS_TOOL_NAME,
      description:
        "Get statistics about the organizational knowledge base (number of indexed chunks, collection name). Useful when the user asks how much content is available or whether the knowledge base is populated.",
      schema: knowledgeBaseStatsInputSchema,
    },
  );
}
