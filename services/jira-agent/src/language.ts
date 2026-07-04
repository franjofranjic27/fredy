const GERMAN_MARKERS =
  /\b(der|die|das|und|oder|nicht|ich|ist|sind|wie|was|wer|wo|kann|könnte|bitte|für|mit|ein|eine|auf|wird|werden|muss|habe|gibt|welche|wenn)\b/i;

/**
 * Cheap language heuristic for deterministic (non-LLM) responses: umlauts/ß
 * or common German function words. Mirrors the RAG agent's fallback picker.
 */
export function isProbablyGerman(text: string): boolean {
  return /[äöüßÄÖÜ]/.test(text) || GERMAN_MARKERS.test(text);
}
