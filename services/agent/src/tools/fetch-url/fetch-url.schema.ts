import { z } from "zod";

export const fetchUrlInputSchema = z.object({
  url: z.string().regex(/^https?:\/\//i, "URL must start with http:// or https://"),
  maxChars: z.number().int().positive().optional(),
});

export type FetchUrlInput = z.infer<typeof fetchUrlInputSchema>;
