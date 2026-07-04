import { describe, expect, it, vi } from "vitest";
import { createFetchUrlTool, isPrivateAddress, type LookupFn } from "./fetch-url.js";

const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

function fetchWithResponses(responses: Response[]): typeof fetch {
  const impl = vi.fn();
  for (const response of responses) impl.mockResolvedValueOnce(response);
  return impl as unknown as typeof fetch;
}

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.5",
  ])("flags %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "192.169.0.1", "2606:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it("treats non-IP strings as unsafe", () => {
    expect(isPrivateAddress("localhost")).toBe(true);
  });
});

describe("fetch_url tool — SSRF protection", () => {
  it("rejects literal loopback URLs without fetching", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup });
    await expect(tool.invoke({ url: "http://127.0.0.1:8080/admin" })).rejects.toThrow(
      /Refusing to fetch private or internal address/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects hostnames resolving to private addresses", async () => {
    const lookup: LookupFn = async () => [{ address: "10.0.0.9", family: 4 }];
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const tool = createFetchUrlTool({ fetchImpl, lookup });
    await expect(tool.invoke({ url: "https://internal.example" })).rejects.toThrow(
      /resolves to 10\.0\.0\.9/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects when any resolved address is private (DNS multi-answer)", async () => {
    const lookup: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.0.2", family: 4 },
    ];
    const tool = createFetchUrlTool({ fetchImpl: vi.fn() as unknown as typeof fetch, lookup });
    await expect(tool.invoke({ url: "https://dual.example" })).rejects.toThrow(
      /Refusing to fetch private or internal address/,
    );
  });

  it("re-validates every redirect hop and blocks redirects into private ranges", async () => {
    const fetchImpl = fetchWithResponses([
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }),
    ]);
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup });
    await expect(tool.invoke({ url: "https://public.example" })).rejects.toThrow(
      /Refusing to fetch private or internal address/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows public redirects up to the limit", async () => {
    const redirect = () =>
      new Response(null, { status: 302, headers: { location: "https://public.example/next" } });
    const fetchImpl = fetchWithResponses([
      redirect(),
      redirect(),
      new Response("final content", { status: 200 }),
    ]);
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup });
    await expect(tool.invoke({ url: "https://public.example" })).resolves.toBe("final content");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails after more than five redirects", async () => {
    const redirect = () =>
      new Response(null, { status: 302, headers: { location: "https://public.example/loop" } });
    const fetchImpl = fetchWithResponses(Array.from({ length: 7 }, redirect));
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup });
    await expect(tool.invoke({ url: "https://public.example" })).rejects.toThrow(
      /Too many redirects/,
    );
  });

  it("blocks a redirect to a non-http(s) scheme before fetching it", async () => {
    const fetchImpl = fetchWithResponses([
      new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } }),
    ]);
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup });
    await expect(tool.invoke({ url: "https://public.example" })).rejects.toThrow(
      /Refusing to follow non-http\(s\) URL/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("fetch_url tool — timeout", () => {
  it("maps an aborted fetch to a timeout error", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchImpl = vi.fn().mockRejectedValue(abortError) as unknown as typeof fetch;
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup, timeoutMs: 5 });
    await expect(tool.invoke({ url: "https://public.example" })).rejects.toThrow(
      "Timed out fetching https://public.example",
    );
  });

  it("passes an AbortSignal to fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const tool = createFetchUrlTool({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: publicLookup,
    });
    await tool.invoke({ url: "https://public.example" });
    const init = fetchImpl.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("fetch_url tool — body handling", () => {
  it("returns the body of a successful response", async () => {
    const fetchImpl = fetchWithResponses([new Response("hello world", { status: 200 })]);
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup });
    await expect(tool.invoke({ url: "https://public.example" })).resolves.toBe("hello world");
  });

  it("caps the body at maxBytes", async () => {
    const fetchImpl = fetchWithResponses([new Response("a".repeat(100), { status: 200 })]);
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup, maxBytes: 10 });
    const result = (await tool.invoke({ url: "https://public.example" })) as string;
    expect(result).toBe("a".repeat(10));
  });

  it("truncates to maxChars with the marker", async () => {
    const fetchImpl = fetchWithResponses([new Response("b".repeat(50), { status: 200 })]);
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup });
    const result = (await tool.invoke({
      url: "https://public.example",
      maxChars: 20,
    })) as string;
    expect(result).toBe(`${"b".repeat(20)}\n...[truncated]`);
  });

  it("throws HTTP errors for non-ok responses", async () => {
    const fetchImpl = fetchWithResponses([new Response("nope", { status: 503 })]);
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup });
    await expect(tool.invoke({ url: "https://public.example" })).rejects.toThrow(
      "HTTP 503 from https://public.example",
    );
  });

  it("wraps network failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;
    const tool = createFetchUrlTool({ fetchImpl, lookup: publicLookup });
    await expect(tool.invoke({ url: "https://public.example" })).rejects.toThrow(
      /Failed to fetch https:\/\/public.example/,
    );
  });

  it("rejects non-http(s) URLs via the schema", async () => {
    const tool = createFetchUrlTool({ lookup: publicLookup });
    await expect(tool.invoke({ url: "file:///etc/passwd" })).rejects.toThrow();
  });
});
