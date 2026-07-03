import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { ObservabilityService } from "../../shared/observability/observability.service";
import { ToolExecutorService } from "../../shared/tools/tool-executor.service";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { ToolDefinition, ToolError, ToolResult } from "../../shared/tools/tool.interface";
import { QueryRewriteService } from "./query-rewrite.service";
import { RetrievalService } from "./retrieval.service";

function createConfig(values: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function createObservability(): ObservabilityService {
  return {
    log: jest.fn(),
    startSpan: jest.fn().mockReturnValue({
      setAttribute: jest.fn(),
      setAttributes: jest.fn(),
      addEvent: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
      isRecording: () => true,
      spanContext: () => ({ traceId: "t", spanId: "s", traceFlags: 0 }),
      updateName: jest.fn(),
    }),
    endSpanOk: jest.fn(),
    endSpanError: jest.fn(),
  } as unknown as ObservabilityService;
}

function makeTool(
  result: ToolResult,
  execute = jest.fn().mockResolvedValue(result),
): ToolDefinition {
  return {
    name: "vector_search",
    description: "search",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().optional(),
      spaceKey: z.string().optional(),
    }),
    execute,
  };
}

function buildService(
  registry: ToolRegistryService,
  observability: ObservabilityService,
  queryRewrite: QueryRewriteService,
  config: ConfigService,
): RetrievalService {
  const executor = new ToolExecutorService(registry, observability);
  return new RetrievalService(registry, executor, observability, queryRewrite, config);
}

describe("RetrievalService", () => {
  let registry: ToolRegistryService;
  let observability: ObservabilityService;
  let queryRewrite: QueryRewriteService;

  beforeEach(() => {
    registry = new ToolRegistryService();
    observability = createObservability();
    queryRewrite = new QueryRewriteService();
  });

  it("returns null when vector_search is not registered", async () => {
    const svc = buildService(registry, observability, queryRewrite, createConfig());
    const result = await svc.getContext("anything", { requestId: "r1" });
    expect(result).toBeNull();
    expect(observability.log).toHaveBeenCalledWith(
      expect.objectContaining({ type: "retrieval", resultCount: 0 }),
    );
  });

  it("returns null when vector_search is registered but not in allowedToolNames", async () => {
    registry.register(makeTool({ output: "X", metadata: { chunks: [{ id: "1" }] } }));
    const svc = buildService(registry, observability, queryRewrite, createConfig());
    const result = await svc.getContext("anything", {
      requestId: "r1",
      allowedToolNames: ["fetch_url"],
    });
    expect(result).toBeNull();
  });

  it("invokes vector_search and returns concatenated context", async () => {
    const execute = jest.fn().mockResolvedValue({
      output: "VPN setup steps...",
      metadata: { chunks: [{ id: "1", url: "https://wiki/vpn" }] },
    });
    registry.register(makeTool({ output: "VPN setup steps..." }, execute));
    const svc = buildService(
      registry,
      observability,
      queryRewrite,
      createConfig({ "retrieval.defaultLimit": 5 }),
    );
    const result = await svc.getContext("How do I VPN?", { requestId: "r1" });
    expect(result).toContain("VPN setup steps...");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ query: "How do I VPN?", limit: 5 }),
      expect.objectContaining({ requestId: "r1", agentId: "rag-agent" }),
    );
    expect(observability.log).toHaveBeenCalledWith(
      expect.objectContaining({ type: "retrieval", resultCount: 1 }),
    );
  });

  it("retries with the raw user message when query expansion yields nothing", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ output: "", metadata: { chunks: [] } })
      .mockResolvedValueOnce({ output: "", metadata: { chunks: [] } })
      .mockResolvedValueOnce({
        output: "fallback hit",
        metadata: { chunks: [{ id: "z" }] },
      });
    registry.register(makeTool({ output: "" }, execute));
    const svc = buildService(registry, observability, queryRewrite, createConfig());
    const result = await svc.getContext("VPN setup? And WiFi password?", {
      requestId: "r1",
    });
    expect(result).toContain("fallback hit");
    expect(execute.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("forwards spaceKey filter to the tool", async () => {
    const execute = jest.fn().mockResolvedValue({
      output: "result",
      metadata: { chunks: [{ id: "1" }] },
    });
    registry.register(makeTool({ output: "result" }, execute));
    const svc = buildService(registry, observability, queryRewrite, createConfig());
    await svc.getContext("test", { requestId: "r1", spaceKey: "IT" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ spaceKey: "IT" }),
      expect.anything(),
    );
  });

  it("logs the error and returns null when the tool fails", async () => {
    const execute = jest
      .fn()
      .mockRejectedValue(
        new ToolError({ code: "upstream_error", message: "vector store down", retryable: true }),
      );
    registry.register(makeTool({ output: "" }, execute));
    const svc = buildService(registry, observability, queryRewrite, createConfig());
    const result = await svc.getContext("test", { requestId: "r1" });
    expect(result).toBeNull();
    expect(observability.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "retrieval",
        resultCount: 0,
        error: expect.objectContaining({ code: "upstream_error" }),
      }),
    );
  });
});
