import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { FetchUrlTool } from "./fetch-url.tool";

describe("FetchUrlTool", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("self-registers on module init", () => {
    const registry = new ToolRegistryService();
    const tool = new FetchUrlTool(registry);
    tool.onModuleInit();
    expect(registry.hasTool("fetch_url")).toBe(true);
  });

  it("rejects non-http URLs without making a network call", async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const tool = new FetchUrlTool(new ToolRegistryService());
    const result = await tool.execute({ url: "file:///etc/passwd" });
    expect(result.success).toBe(false);
    expect(result.output).toContain("must start with http");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns truncated body when response exceeds maxChars", async () => {
    const big = "x".repeat(5000);
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(big, { status: 200 })) as unknown as typeof fetch;
    const tool = new FetchUrlTool(new ToolRegistryService());
    const result = await tool.execute({ url: "https://example.com", maxChars: 100 });
    expect(result.success).toBe(true);
    expect(result.output.length).toBeLessThan(big.length);
    expect(result.output).toContain("[truncated]");
  });

  it("returns success:false when fetch throws", async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error("ENOTFOUND")) as unknown as typeof fetch;
    const tool = new FetchUrlTool(new ToolRegistryService());
    const result = await tool.execute({ url: "https://example.com" });
    expect(result.success).toBe(false);
    expect(result.output).toContain("ENOTFOUND");
  });
});
