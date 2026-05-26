import { estimateTokens, trimToTokenBudget } from "./token-utils";

describe("token-utils", () => {
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
    });
  });
});
