import { describe, expect, it } from "vitest";
import { recallAtK } from "./recall.js";

describe("recallAtK", () => {
  it("returns 1 when all relevant items are in top-k", () => {
    expect(recallAtK(["a", "b", "c"], ["a", "b"], 3)).toBe(1);
  });

  it("returns the fraction of relevant items found in top-k", () => {
    expect(recallAtK(["a", "x", "y"], ["a", "b"], 3)).toBe(0.5);
  });

  it("returns 0 when no retrieved ids match relevant ids", () => {
    expect(recallAtK(["x", "y", "z"], ["a", "b"], 3)).toBe(0);
  });

  it("returns 0 for empty retrieved list", () => {
    expect(recallAtK([], ["a", "b"], 5)).toBe(0);
  });

  it("returns 0 when relevant list is empty", () => {
    expect(recallAtK(["a", "b"], [], 3)).toBe(0);
  });

  it("only considers the first k retrieved ids", () => {
    expect(recallAtK(["x", "y", "a", "b"], ["a", "b"], 2)).toBe(0);
    expect(recallAtK(["x", "y", "a", "b"], ["a", "b"], 4)).toBe(1);
  });

  it("handles k larger than retrieved list", () => {
    expect(recallAtK(["a"], ["a", "b"], 10)).toBe(0.5);
  });

  it("deduplicates relevant ids by treating them as a set", () => {
    expect(recallAtK(["a"], ["a", "a"], 1)).toBe(1);
  });

  it("throws on non-positive k", () => {
    expect(() => recallAtK(["a"], ["a"], 0)).toThrow();
    expect(() => recallAtK(["a"], ["a"], -1)).toThrow();
  });
});
