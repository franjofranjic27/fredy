import { QueryRewriteService } from "./query-rewrite.service";

describe("QueryRewriteService", () => {
  let svc: QueryRewriteService;
  beforeEach(() => {
    svc = new QueryRewriteService();
  });

  it("returns an empty list for empty input", () => {
    expect(svc.rewrite("")).toEqual([]);
    expect(svc.rewrite("   ")).toEqual([]);
  });

  it("returns the original query for a single short prompt", () => {
    expect(svc.rewrite("VPN setup")).toEqual(["VPN setup"]);
  });

  it("expands compound questions split by ?", () => {
    const result = svc.rewrite("How do I VPN? And what is the WiFi password?");
    expect(result[0]).toBe("How do I VPN? And what is the WiFi password?");
    expect(result.length).toBeGreaterThan(1);
    expect(result).toContain("How do I VPN");
  });

  it("expands queries joined by 'und'", () => {
    const result = svc.rewrite("VPN einrichten und WLAN konfigurieren");
    expect(result.length).toBeGreaterThan(1);
    expect(result).toContain("VPN einrichten");
    expect(result).toContain("WLAN konfigurieren");
  });

  it("caps at 5 queries", () => {
    const result = svc.rewrite(
      "first thing? second item and third part and fourth? fifth question? sixth and seventh?",
    );
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("de-duplicates trivially identical fragments", () => {
    const result = svc.rewrite("VPN setup");
    expect(new Set(result).size).toBe(result.length);
  });
});
