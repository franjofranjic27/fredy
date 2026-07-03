import { z } from "zod";

export const knowledgeBaseStatsInputSchema = z.object({}).strict();

export type KnowledgeBaseStatsInput = z.infer<typeof knowledgeBaseStatsInputSchema>;
