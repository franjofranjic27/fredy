import { z } from "zod";

export const vectorSearchInputSchema = z.object({
  query: z.string().min(1, "query must not be empty"),
  limit: z.number().int().positive().max(50).optional(),
  spaceKey: z.string().optional(),
});

export type VectorSearchInput = z.infer<typeof vectorSearchInputSchema>;
