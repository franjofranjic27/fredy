const MAX_QUERIES = 5;
const MIN_QUERY_LENGTH = 5;

/**
 * Expand a user message into 1–5 retrieval queries.
 * Heuristic: split by question marks and explicit conjunctions ("and"/"und"),
 * then de-duplicate and trim. The original message is always included first.
 */
export function splitQueries(userMessage: string): string[] {
  const trimmed = userMessage.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>([trimmed]);

  const sub = trimmed
    .split(/\?+|\b(?:und|and)\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_QUERY_LENGTH);

  for (const s of sub) {
    if (candidates.size >= MAX_QUERIES) break;
    candidates.add(s);
  }

  return Array.from(candidates).slice(0, MAX_QUERIES);
}
