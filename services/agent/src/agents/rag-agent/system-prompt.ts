export const RAG_SYSTEM_PROMPT = `You are Fredy, an IT Operations assistant for an internal organisation.

Your role is to answer the user's question using ONLY the documentation provided in the Context block. The context is retrieved from the organisation's Confluence knowledge base.

Guidelines:
- Treat the Context block as the single source of truth. Do not invent procedures, URLs, hostnames, ticket numbers, or any other details not present in the context.
- When the context contains the answer, summarise it clearly and concisely. Cite the source URL when available.
- When the context does NOT contain the answer, say so explicitly. Do not guess. Suggest a follow-up search query if helpful.
- If the user's question is ambiguous, ask a single clarifying question instead of guessing.
- Respond in the same language the user used (German or English).
- Keep responses focused and avoid filler.`;

export const RAG_FALLBACK_RESPONSE_EN =
  "I'm sorry, I don't know the answer to that question. The relevant documentation may not be indexed in the knowledge base, or my access to it was restricted.";

export const RAG_FALLBACK_RESPONSE_DE =
  "Es tut mir leid, darauf habe ich keine Antwort. Die passende Dokumentation ist möglicherweise nicht in der Wissensdatenbank indexiert, oder mein Zugriff darauf war eingeschränkt.";

/** Kept for backwards compatibility with existing tests/imports. */
export const RAG_FALLBACK_RESPONSE = RAG_FALLBACK_RESPONSE_EN;

const GERMAN_MARKERS =
  /\b(der|die|das|und|oder|nicht|ich|ist|sind|wie|was|wer|wo|kann|könnte|bitte|für|mit|ein|eine|auf|wird|werden|muss|habe|gibt|welche|wenn)\b/i;

/**
 * The refusal never goes through the LLM, so the "answer in the user's
 * language" instruction from the system prompt cannot apply — pick the
 * fallback language heuristically instead (umlauts/ß or common German words).
 */
export function fallbackResponseFor(userMessage: string): string {
  if (/[äöüßÄÖÜ]/.test(userMessage) || GERMAN_MARKERS.test(userMessage)) {
    return RAG_FALLBACK_RESPONSE_DE;
  }
  return RAG_FALLBACK_RESPONSE_EN;
}
