import { describe, expect, it } from "vitest";
import { hitRate } from "./hit-rate.js";

describe("hitRate", () => {
  it("returns 1 when at least one relevant id is retrieved", () => {
    expect(hitRate(["x", "a"], ["a", "b"])).toBe(1);
  });

  it("returns 0 when no relevant id is retrieved", () => {
    expect(hitRate(["x", "y"], ["a", "b"])).toBe(0);
  });

  it("returns 0 for empty retrieved list", () => {
    expect(hitRate([], ["a"])).toBe(0);
  });

  it("returns 0 when relevant list is empty", () => {
    expect(hitRate(["a", "b"], [])).toBe(0);
  });
});
