import { describe, it, expect } from "vitest";
import { countTokens } from "../../chunking/tokenizer.js";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("returns a positive count for a simple word", () => {
    expect(countTokens("hello")).toBeGreaterThan(0);
  });

  it("returns more tokens for longer text", () => {
    const short = countTokens("Hello");
    const long = countTokens("Hello world, this is a longer sentence with more words and content.");
    expect(long).toBeGreaterThan(short);
  });

  it("is deterministic for the same input", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    expect(countTokens(text)).toBe(countTokens(text));
  });

  it("counts tokens for code strings", () => {
    const code = "const x = 1;\nconst y = 2;\nreturn x + y;";
    expect(countTokens(code)).toBeGreaterThan(0);
  });

  it("handles whitespace-only strings", () => {
    // Whitespace produces some tokens in BPE
    expect(typeof countTokens("   ")).toBe("number");
  });
});
