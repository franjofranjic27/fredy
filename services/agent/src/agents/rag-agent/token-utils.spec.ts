import { describe, expect, it } from "vitest";
import {
  CONTEXT_BLOCK_SEPARATOR,
  estimateTokens,
  trimHistoryToBudget,
  trimToTokenBudget,
} from "./token-utils.js";

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("approximates tokens as ceil(chars/4)", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("trimToTokenBudget", () => {
  it("returns empty string when budget is 0 or negative", () => {
    expect(trimToTokenBudget("hello", 0)).toBe("");
    expect(trimToTokenBudget("hello", -1)).toBe("");
  });

  it("returns the full text when within budget", () => {
    const text = "short";
    expect(trimToTokenBudget(text, 100)).toBe(text);
  });

  it("truncates and appends marker when over budget", () => {
    const text = "a".repeat(1000);
    const result = trimToTokenBudget(text, 10); // 40 chars
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain("[truncated]");
    expect(result.startsWith("a".repeat(40))).toBe(true);
  });

  it("drops whole blocks at the separator instead of cutting mid-chunk", () => {
    const blockA = "A".repeat(60);
    const blockB = "B".repeat(60);
    const blockC = "C".repeat(60);
    const text = [blockA, blockB, blockC].join(CONTEXT_BLOCK_SEPARATOR);
    // Budget of 35 tokens = 140 chars: fits A + separator + B, but not C.
    const result = trimToTokenBudget(text, 35);
    expect(result).toContain(blockA);
    expect(result).toContain(blockB);
    expect(result).not.toContain("C");
    expect(result).toContain("[truncated]");
  });

  it("hard-truncates a single block that exceeds the budget on its own", () => {
    const text = "A".repeat(500);
    const result = trimToTokenBudget(text, 10); // 40 chars
    expect(result.startsWith("A".repeat(40))).toBe(true);
    expect(result).toContain("[truncated]");
  });
});

describe("trimHistoryToBudget", () => {
  const message = (content: string) => ({ content });

  it("keeps everything within budget", () => {
    const messages = [message("one"), message("two"), message("three")];
    expect(trimHistoryToBudget(messages, 100)).toEqual(messages);
  });

  it("drops the oldest messages first when over budget", () => {
    const messages = [message("x".repeat(200)), message("y".repeat(200)), message("latest")];
    const kept = trimHistoryToBudget(messages, 55); // 220 chars: latest + one 200-char message
    expect(kept).toEqual([message("y".repeat(200)), message("latest")]);
  });

  it("always keeps the latest message even when it alone exceeds the budget", () => {
    const messages = [message("old"), message("z".repeat(400))];
    const kept = trimHistoryToBudget(messages, 10);
    expect(kept).toEqual([message("z".repeat(400))]);
  });

  it("returns empty for empty input", () => {
    expect(trimHistoryToBudget([], 10)).toEqual([]);
  });
});
