import { z } from "zod";
import { ObservabilityService } from "../../shared/observability/observability.service";
import { ToolExecutorService } from "../../shared/tools/tool-executor.service";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { ToolDefinition, ToolError, ToolResult } from "../../shared/tools/tool.interface";
import { McpService } from "./mcp.service";

function makeTool(name: string, result: ToolResult, execute?: jest.Mock): ToolDefinition {
  return {
    name,
    description: `Test tool ${name}`,
    inputSchema: z.object({ query: z.string().optional() }),
    execute: execute ?? jest.fn().mockResolvedValue(result),
  };
}

interface InternalServer {
  _requestHandlers: Map<
    string,
    (request: {
      method: string;
      params: { name?: string; arguments?: unknown };
    }) => Promise<unknown>
  >;
}

async function invoke(
  server: unknown,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const handlers = (server as unknown as InternalServer)._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No handler registered for ${method}`);
  return handler({ method, params });
}

function createObservability(): ObservabilityService {
  return { log: jest.fn() } as unknown as ObservabilityService;
}

function buildService(registry: ToolRegistryService): McpService {
  const executor = new ToolExecutorService(registry, createObservability());
  return new McpService(registry, executor);
}

describe("McpService", () => {
  let registry: ToolRegistryService;

  beforeEach(() => {
    registry = new ToolRegistryService();
  });

  it("lists every registered tool with JSON schema derived from Zod", async () => {
    registry.register(makeTool("vector_search", { output: "" }));
    registry.register(makeTool("fetch_url", { output: "" }));
    const svc = buildService(registry);
    const server = svc.createServer();
    const result = (await invoke(server, "tools/list")) as {
      tools: Array<{ name: string; description: string; inputSchema: unknown }>;
    };
    expect(result.tools.map((t) => t.name)).toEqual(["vector_search", "fetch_url"]);
    expect(result.tools[0].description).toContain("vector_search");
    expect(result.tools[0].inputSchema).toMatchObject({
      type: "object",
      properties: { query: expect.any(Object) },
    });
  });

  it("delegates tools/call to the registered tool via executor and wraps the output", async () => {
    const execute = jest.fn().mockResolvedValue({ output: "found 3 chunks" });
    registry.register(makeTool("vector_search", { output: "" }, execute));
    const svc = buildService(registry);
    const server = svc.createServer();
    const result = (await invoke(server, "tools/call", {
      name: "vector_search",
      arguments: { query: "VPN" },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(execute).toHaveBeenCalledWith(
      { query: "VPN" },
      expect.objectContaining({ agentId: "mcp-bridge" }),
    );
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "found 3 chunks" }]);
  });

  it("returns isError=true for unknown tools", async () => {
    const svc = buildService(registry);
    const server = svc.createServer();
    const result = (await invoke(server, "tools/call", {
      name: "unknown",
      arguments: {},
    })) as { isError: boolean; content: Array<{ type: string; text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not_found");
  });

  it("returns isError=true with [code] message when the tool throws a ToolError", async () => {
    const execute = jest
      .fn()
      .mockRejectedValue(
        new ToolError({ code: "upstream_error", message: "boom", retryable: false }),
      );
    registry.register(makeTool("vector_search", { output: "" }, execute));
    const svc = buildService(registry);
    const server = svc.createServer();
    const result = (await invoke(server, "tools/call", {
      name: "vector_search",
      arguments: {},
    })) as { isError: boolean; content: Array<{ type: string; text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[upstream_error]");
    expect(result.content[0].text).toContain("boom");
  });

  it("returns isError=true with [internal] when the tool throws a plain error", async () => {
    const execute = jest.fn().mockRejectedValue(new Error("boom"));
    registry.register(makeTool("vector_search", { output: "" }, execute));
    const svc = buildService(registry);
    const server = svc.createServer();
    const result = (await invoke(server, "tools/call", {
      name: "vector_search",
      arguments: {},
    })) as { isError: boolean; content: Array<{ type: string; text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("[internal]");
  });
});
