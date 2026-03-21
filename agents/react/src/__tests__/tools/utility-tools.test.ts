import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import { lookup } from "node:dns/promises";
import { fetchUrlTool } from "../../tools/utility-tools.js";

function makePublicLookup(): void {
  vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
}

function makeTextResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchUrlTool", () => {
  describe("private IP blocking", () => {
    it("blocks 10.0.0.0/8 addresses", async () => {
      await expect(fetchUrlTool.execute({ url: "http://10.0.0.1/resource" })).rejects.toThrow(
        "URL targets a private/internal host",
      );
    });

    it("blocks 127.0.0.0/8 loopback", async () => {
      await expect(fetchUrlTool.execute({ url: "http://127.0.0.1/test" })).rejects.toThrow(
        "URL targets a private/internal host",
      );
    });

    it("blocks 192.168.0.0/16 addresses", async () => {
      await expect(fetchUrlTool.execute({ url: "http://192.168.1.100/" })).rejects.toThrow(
        "URL targets a private/internal host",
      );
    });

    it("blocks 172.16.0.0/12 addresses", async () => {
      await expect(fetchUrlTool.execute({ url: "http://172.16.0.1/" })).rejects.toThrow(
        "URL targets a private/internal host",
      );
    });

    it("blocks 0.0.0.0/8 (unspecified range)", async () => {
      await expect(fetchUrlTool.execute({ url: "http://0.0.0.1/test" })).rejects.toThrow(
        "URL targets a private/internal host",
      );
    });

    it("blocks non-http schemes (ftp)", async () => {
      await expect(fetchUrlTool.execute({ url: "ftp://example.com/file" })).rejects.toThrow(
        "URL targets a private/internal host",
      );
    });

    it("blocks unparseable URLs", async () => {
      await expect(fetchUrlTool.execute({ url: "not-a-valid-url" })).rejects.toThrow(
        "URL targets a private/internal host",
      );
    });

    it("blocks hostnames that resolve to private IP", async () => {
      vi.mocked(lookup).mockResolvedValue([{ address: "10.0.0.1", family: 4 }] as never);

      await expect(fetchUrlTool.execute({ url: "http://internal.corp/" })).rejects.toThrow(
        "URL targets a private/internal host",
      );
    });

    it("blocks hostnames when DNS lookup fails (fail-safe)", async () => {
      vi.mocked(lookup).mockRejectedValue(new Error("ENOTFOUND"));

      await expect(fetchUrlTool.execute({ url: "http://nonexistent.invalid/" })).rejects.toThrow(
        "URL targets a private/internal host",
      );
    });
  });

  describe("redirects", () => {
    it("throws when response is a 301 redirect", async () => {
      makePublicLookup();
      vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 301 }));

      await expect(fetchUrlTool.execute({ url: "http://example.com/" })).rejects.toThrow(
        "URL redirects are not allowed",
      );
    });

    it("throws when response is a 302 redirect", async () => {
      makePublicLookup();
      vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 302 }));

      await expect(fetchUrlTool.execute({ url: "http://example.com/" })).rejects.toThrow(
        "URL redirects are not allowed",
      );
    });
  });

  describe("successful fetch", () => {
    it("returns status and body for a public URL", async () => {
      makePublicLookup();
      vi.mocked(fetch).mockResolvedValueOnce(makeTextResponse("<html>content</html>", 200));

      const result = await fetchUrlTool.execute({ url: "http://example.com/" });

      expect(result.status).toBe(200);
      expect(result.body).toBe("<html>content</html>");
    });

    it("truncates body to 2000 characters", async () => {
      makePublicLookup();
      const longBody = "x".repeat(3000);
      vi.mocked(fetch).mockResolvedValueOnce(makeTextResponse(longBody, 200));

      const result = await fetchUrlTool.execute({ url: "http://example.com/" });

      expect(result.body).toHaveLength(2000);
    });

    it("returns non-200 status codes without throwing", async () => {
      makePublicLookup();
      vi.mocked(fetch).mockResolvedValueOnce(makeTextResponse("Not Found", 404));

      const result = await fetchUrlTool.execute({ url: "http://example.com/" });

      expect(result.status).toBe(404);
    });

    it("passes redirect=manual to fetch", async () => {
      makePublicLookup();
      vi.mocked(fetch).mockResolvedValueOnce(makeTextResponse("ok", 200));

      await fetchUrlTool.execute({ url: "http://example.com/" });

      const [, init] = vi.mocked(fetch).mock.calls[0]!;
      expect((init as RequestInit).redirect).toBe("manual");
    });
  });
});
