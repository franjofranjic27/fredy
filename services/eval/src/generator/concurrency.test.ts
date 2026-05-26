import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  it("preserves input order in the output", async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it("never runs more than `limit` mappers in parallel", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("returns null at indexes where the mapper threw", async () => {
    const result = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("nope");
      return n;
    });
    expect(result).toEqual([1, null, 3]);
  });

  it("handles empty input", async () => {
    const result = await mapWithConcurrency([], 4, async (n) => n);
    expect(result).toEqual([]);
  });
});
