import { getEncoding } from "js-tiktoken";

// cl100k_base is used by text-embedding-3-* and GPT-4 models
const enc = getEncoding("cl100k_base");

/**
 * Count tokens in a string using the cl100k_base BPE tokenizer.
 * More accurate than the 1-token-per-4-chars heuristic, especially
 * for code, URLs, and non-English text.
 */
export function countTokens(text: string): number {
  return enc.encode(text).length;
}
