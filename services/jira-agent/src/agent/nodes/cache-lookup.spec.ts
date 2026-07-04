import { describe, expect, it } from "vitest";
import { normalizeQuestion } from "./cache-lookup.js";

describe("normalizeQuestion", () => {
  it("joins summary and description with collapsed whitespace", () => {
    expect(normalizeQuestion("VPN   kaputt", "Seit  heute\tgeht nichts.")).toBe(
      "VPN kaputt\n\nSeit heute geht nichts.",
    );
  });

  it("caps the question length", () => {
    const question = normalizeQuestion("s", "x".repeat(20_000));
    expect(question.length).toBeLessThanOrEqual(8000);
  });
});
