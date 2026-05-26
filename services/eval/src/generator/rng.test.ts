import { describe, expect, it } from "vitest";
import { SeededRng } from "./rng.js";

describe("SeededRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces a different sequence for different seeds", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("returns values in [0, 1)", () => {
    const rng = new SeededRng(7);
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("shuffles deterministically given the same seed", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = new SeededRng(123).shuffle([...items]);
    const b = new SeededRng(123).shuffle([...items]);
    expect(a).toEqual(b);
  });

  it("shuffle preserves the multiset of items", () => {
    const items = [1, 2, 3, 4, 5];
    const shuffled = new SeededRng(99).shuffle([...items]);
    expect([...shuffled].sort()).toEqual([...items].sort());
  });
});
