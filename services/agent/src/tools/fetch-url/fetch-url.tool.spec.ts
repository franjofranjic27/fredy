import { ToolError } from "../../shared/tools/tool.interface";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { fetchUrlInputSchema } from "./fetch-url.schema";
import { FetchUrlTool } from "./fetch-url.tool";

const ctx = { requestId: "r1" };

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

  it("schema rejects non-http URLs", () => {
    const result = fetchUrlInputSchema.safeParse({ url: "file:///etc/passwd" });
    expect(result.success).toBe(false);
  });

  it("returns truncated body when response exceeds maxChars", async () => {
    const big = "x".repeat(5000);
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response(big, { status: 200 })) as unknown as typeof fetch;
    const tool = new FetchUrlTool(new ToolRegistryService());
    const result = await tool.execute({ url: "https://example.com", maxChars: 100 }, ctx);
    expect(result.output.length).toBeLessThan(big.length);
    expect(result.output).toContain("[truncated]");
    expect(result.data?.status).toBe(200);
  });

  it("throws upstream_error when fetch rejects", async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error("ENOTFOUND")) as unknown as typeof fetch;
    const tool = new FetchUrlTool(new ToolRegistryService());
    await expect(tool.execute({ url: "https://example.com" }, ctx)).rejects.toMatchObject({
      code: "upstream_error",
      retryable: true,
    });
  });

  it("throws upstream_error with retryable=true on 5xx", async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response("err", { status: 503 })) as unknown as typeof fetch;
    const tool = new FetchUrlTool(new ToolRegistryService());
    await expect(tool.execute({ url: "https://example.com" }, ctx)).rejects.toMatchObject({
      code: "upstream_error",
      retryable: true,
    });
  });

  it("throws upstream_error with retryable=false on 4xx", async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response("nf", { status: 404 })) as unknown as typeof fetch;
    const tool = new FetchUrlTool(new ToolRegistryService());
    let caught: unknown;
    try {
      await tool.execute({ url: "https://example.com" }, ctx);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToolError);
    expect((caught as ToolError).code).toBe("upstream_error");
    expect((caught as ToolError).retryable).toBe(false);
  });
});
