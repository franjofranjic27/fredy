import { describe, expect, it } from "vitest";
import { meanReciprocalRank } from "./mrr.js";

describe("meanReciprocalRank (per-query reciprocal rank)", () => {
  it("returns 1 when first retrieved item is relevant", () => {
    expect(meanReciprocalRank(["a", "x", "y"], ["a"])).toBe(1);
  });

  it("returns 1/2 when second retrieved item is the first relevant hit", () => {
    expect(meanReciprocalRank(["x", "a"], ["a"])).toBe(1 / 2);
  });

  it("returns 1/3 when third retrieved item is the first relevant hit", () => {
    expect(meanReciprocalRank(["x", "y", "a"], ["a", "b"])).toBe(1 / 3);
  });

  it("returns 0 when no retrieved item is relevant", () => {
    expect(meanReciprocalRank(["x", "y"], ["a", "b"])).toBe(0);
  });

  it("returns 0 for empty retrieved list", () => {
    expect(meanReciprocalRank([], ["a"])).toBe(0);
  });

  it("returns 0 when relevant list is empty", () => {
    expect(meanReciprocalRank(["a", "b"], [])).toBe(0);
  });

  it("only counts the first relevant hit", () => {
    expect(meanReciprocalRank(["x", "a", "b"], ["a", "b"])).toBe(1 / 2);
  });
});
