import { describe, expect, it } from "vitest";
import { ndcgAtK } from "./ndcg.js";

describe("ndcgAtK (binary relevance)", () => {
  it("returns 1 for a perfect ranking", () => {
    expect(ndcgAtK(["a", "b", "c"], ["a", "b", "c"], 3)).toBeCloseTo(1, 10);
  });

  it("returns 1 when only relevant items appear at top, even with k > relevant", () => {
    expect(ndcgAtK(["a", "b"], ["a", "b"], 5)).toBeCloseTo(1, 10);
  });

  it("returns 0 when no relevant items are retrieved", () => {
    expect(ndcgAtK(["x", "y"], ["a", "b"], 2)).toBe(0);
  });

  it("returns 0 when relevant list is empty", () => {
    expect(ndcgAtK(["a"], [], 3)).toBe(0);
  });

  it("penalises later positions correctly", () => {
    const perfect = ndcgAtK(["a", "x"], ["a"], 2);
    const swapped = ndcgAtK(["x", "a"], ["a"], 2);
    expect(perfect).toBeGreaterThan(swapped);
    expect(perfect).toBeCloseTo(1, 10);
    expect(swapped).toBeCloseTo(1 / Math.log2(3), 10);
  });

  it("respects k cutoff", () => {
    expect(ndcgAtK(["x", "a"], ["a"], 1)).toBe(0);
  });

  it("throws on non-positive k", () => {
    expect(() => ndcgAtK(["a"], ["a"], 0)).toThrow();
  });
});
