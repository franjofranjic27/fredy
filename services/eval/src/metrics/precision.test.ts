import { describe, expect, it } from "vitest";
import { precisionAtK } from "./precision.js";

describe("precisionAtK", () => {
  it("returns 1 when all top-k results are relevant", () => {
    expect(precisionAtK(["a", "b"], ["a", "b", "c"], 2)).toBe(1);
  });

  it("returns 0.5 when half of top-k are relevant", () => {
    expect(precisionAtK(["a", "x"], ["a", "b"], 2)).toBe(0.5);
  });

  it("returns 0 when none of top-k are relevant", () => {
    expect(precisionAtK(["x", "y"], ["a", "b"], 2)).toBe(0);
  });

  it("returns 0 for empty retrieved list", () => {
    expect(precisionAtK([], ["a"], 5)).toBe(0);
  });

  it("uses the actual retrieved size when retrieved < k", () => {
    expect(precisionAtK(["a"], ["a", "b"], 5)).toBe(1);
  });

  it("ignores items beyond k", () => {
    expect(precisionAtK(["x", "a", "b"], ["a", "b"], 1)).toBe(0);
  });

  it("treats relevant ids as a set", () => {
    expect(precisionAtK(["a"], ["a", "a"], 1)).toBe(1);
  });

  it("throws on non-positive k", () => {
    expect(() => precisionAtK(["a"], ["a"], 0)).toThrow();
  });
});
