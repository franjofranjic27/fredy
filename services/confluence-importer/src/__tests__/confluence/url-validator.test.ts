import { describe, it, expect } from "vitest";
import { validateConfluenceBaseUrl } from "../../confluence/url-validator.js";

describe("validateConfluenceBaseUrl", () => {
  describe("accepts valid URLs", () => {
    it.each([
      "https://company.atlassian.net/wiki",
      "https://company.atlassian.net/wiki/",
      "https://confluence.example.com",
      "https://confluence.example.com/",
      "https://confluence.example.com/confluence",
      "http://localhost:8090",
    ])("ok: %s", (url) => {
      const result = validateConfluenceBaseUrl(url);
      expect(result.ok, result.errors.join(" | ")).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("rejects unparseable strings", () => {
    it.each(["", "not-a-url", "company.atlassian.net/wiki", "://broken"])("rejects: %s", (url) => {
      const result = validateConfluenceBaseUrl(url);
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toMatch(/not a valid URL/);
    });
  });

  it("rejects non-http(s) protocols", () => {
    const result = validateConfluenceBaseUrl("ftp://confluence.example.com");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/must use http\(s\)/);
  });

  describe("rejects URLs containing forbidden path fragments", () => {
    it.each([
      "https://company.atlassian.net/wiki/spaces/IT",
      "https://company.atlassian.net/wiki/spaces/IT/pages/123",
      "https://company.atlassian.net/wiki/display/IT/Home",
      "https://confluence.example.com/spaces/IT",
      "https://confluence.example.com/display/IT/Home",
      "https://confluence.example.com/pages/viewpage.action?pageId=42",
      "https://company.atlassian.net/wiki/rest/api/space/IT",
    ])("rejects: %s", (url) => {
      const result = validateConfluenceBaseUrl(url);
      expect(result.ok).toBe(false);
      expect(result.errors.join(" ")).toMatch(/Confluence root/);
    });
  });

  describe("Atlassian Cloud sites must end in /wiki", () => {
    it("rejects atlassian.net without /wiki", () => {
      const result = validateConfluenceBaseUrl("https://company.atlassian.net");
      expect(result.ok).toBe(false);
      expect(result.errors.join(" ")).toMatch(/must end in "\/wiki"/);
    });

    it("rejects atlassian.net with /wiki2 (similar but wrong)", () => {
      const result = validateConfluenceBaseUrl("https://company.atlassian.net/wiki2");
      expect(result.ok).toBe(false);
      expect(result.errors.join(" ")).toMatch(/must end in "\/wiki"/);
    });

    it("accepts trailing slash", () => {
      const result = validateConfluenceBaseUrl("https://company.atlassian.net/wiki/");
      expect(result.ok).toBe(true);
    });
  });

  it("rejects .atlassian.com (typo for .atlassian.net)", () => {
    const result = validateConfluenceBaseUrl("https://company.atlassian.com/wiki");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/atlassian\.com/);
  });

  it("does not enforce /wiki on self-hosted hostnames", () => {
    const result = validateConfluenceBaseUrl("https://confluence.example.com");
    expect(result.ok).toBe(true);
  });
});
