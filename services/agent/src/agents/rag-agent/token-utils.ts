/**
 * Rough character-based token estimation. Real tokenisers differ per provider
 * but a ratio of ~4 chars/token holds for English/German prose well enough
 * for budget enforcement.
 */
const CHARS_PER_TOKEN = 4;

export const CONTEXT_BLOCK_SEPARATOR = "\n\n---\n\n";

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Trims retrieval context to the token budget at block boundaries: whole
 * blocks are dropped from the end rather than cutting mid-chunk, because a
 * half procedure is worse than a missing one in an IT-Ops context. A single
 * oversized block still falls back to a hard character cut.
 */
export function trimToTokenBudget(
  text: string,
  budgetTokens: number,
  separator: string = CONTEXT_BLOCK_SEPARATOR,
): string {
  if (budgetTokens <= 0) return "";
  const maxChars = budgetTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;

  const blocks = text.split(separator);
  const kept: string[] = [];
  let length = 0;
  for (const block of blocks) {
    const extra = (kept.length > 0 ? separator.length : 0) + block.length;
    if (length + extra > maxChars) break;
    kept.push(block);
    length += extra;
  }
  if (kept.length === 0) {
    return `${text.slice(0, maxChars)}\n...[truncated]`;
  }
  return `${kept.join(separator)}\n...[truncated]`;
}

export interface BudgetableMessage {
  readonly content: string;
}

/**
 * Keeps the most recent messages that fit the token budget (the latest
 * message is always kept). Prevents long client-side histories from growing
 * the prompt unboundedly — only the context window was budgeted before.
 */
export function trimHistoryToBudget<T extends BudgetableMessage>(
  messages: readonly T[],
  budgetTokens: number,
): T[] {
  if (messages.length === 0) return [];
  const kept: T[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const cost = estimateTokens(messages[i].content);
    if (kept.length > 0 && total + cost > budgetTokens) break;
    kept.unshift(messages[i]);
    total += cost;
  }
  return kept;
}
