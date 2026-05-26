import { z } from "zod";

export const EvalCaseSchema = z
  .object({
    queryId: z.string().min(1),
    query: z.string().min(1),
    relevantChunkIds: z.array(z.string().min(1)).min(1),
    source: z.string().min(1),
    metadata: z.record(z.unknown()).default({}),
  })
  .passthrough();

export type EvalCase = z.infer<typeof EvalCaseSchema>;
