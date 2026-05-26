/**
 * Rough character-based token estimation. Real tokenisers differ per provider
 * but a ratio of ~4 chars/token holds for English/German prose well enough
 * for budget enforcement.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function trimToTokenBudget(text: string, budgetTokens: number): string {
  if (budgetTokens <= 0) return "";
  const maxChars = budgetTokens * CHARS_PER_TOKEN;
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}
