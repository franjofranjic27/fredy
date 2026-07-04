import { describe, expect, it } from "vitest";
import { splitQueries } from "./query-split.js";

describe("splitQueries", () => {
  it("returns an empty list for empty input", () => {
    expect(splitQueries("")).toEqual([]);
    expect(splitQueries("   ")).toEqual([]);
  });

  it("returns the original query for a single short prompt", () => {
    expect(splitQueries("VPN setup")).toEqual(["VPN setup"]);
  });

  it("expands compound questions split by ?", () => {
    const result = splitQueries("How do I VPN? And what is the WiFi password?");
    expect(result[0]).toBe("How do I VPN? And what is the WiFi password?");
    expect(result.length).toBeGreaterThan(1);
    expect(result).toContain("How do I VPN");
  });

  it("expands queries joined by 'und'", () => {
    const result = splitQueries("VPN einrichten und WLAN konfigurieren");
    expect(result.length).toBeGreaterThan(1);
    expect(result).toContain("VPN einrichten");
    expect(result).toContain("WLAN konfigurieren");
  });

  it("caps at 5 queries", () => {
    const result = splitQueries(
      "first thing? second item and third part and fourth? fifth question? sixth and seventh?",
    );
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("drops fragments shorter than five characters", () => {
    const result = splitQueries("VPN and WiFi setup instructions");
    expect(result).not.toContain("VPN");
  });

  it("de-duplicates trivially identical fragments", () => {
    const result = splitQueries("VPN setup");
    expect(new Set(result).size).toBe(result.length);
  });
});
