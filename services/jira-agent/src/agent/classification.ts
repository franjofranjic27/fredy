import { z } from "zod";

export const CLASSIFICATION_PATHS = [
  "use_cache",
  "need_context",
  "ask_reporter",
  "answer",
  "escalate",
] as const;

export type ClassificationPath = (typeof CLASSIFICATION_PATHS)[number];

export const classificationSchema = z.object({
  path: z.enum(CLASSIFICATION_PATHS),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  language: z.string().describe("BCP-47 language of the ticket, e.g. 'de' or 'en'"),
  retrievalQuery: z
    .string()
    .optional()
    .describe("Standalone knowledge-base search query when path is need_context"),
  missingInfo: z
    .array(z.string())
    .optional()
    .describe("Facts the reporter must provide when path is ask_reporter"),
});

export type Classification = z.infer<typeof classificationSchema>;

/** Below this confidence the agent never acts on its own decision. */
export const CONFIDENCE_FLOOR = 0.4;
/** Answers below this confidence are not worth caching as future evidence. */
export const CACHE_WRITE_MIN_CONFIDENCE = 0.6;
/** After this many unanswered clarification rounds a human takes over. */
export const MAX_CLARIFICATION_ROUNDS = 2;
/** The graph allows exactly one retrieval round before it must conclude. */
export const MAX_RETRIEVAL_ROUNDS = 1;
