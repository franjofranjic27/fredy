import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { Tool, ToolResult } from "../../shared/tools/tool.interface";
import { McpService } from "./mcp.service";

function makeTool(name: string, result: ToolResult, execute?: jest.Mock): Tool {
  return {
    description: {
      name,
      description: `Test tool ${name}`,
      parametersJsonSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    },
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

describe("McpService", () => {
  let registry: ToolRegistryService;

  beforeEach(() => {
    registry = new ToolRegistryService();
  });

  it("lists every registered tool as an MCP tool descriptor", async () => {
    registry.register(makeTool("vector_search", { success: true, output: "" }));
    registry.register(makeTool("fetch_url", { success: true, output: "" }));
    const svc = new McpService(registry);
    const server = svc.createServer();
    const result = (await invoke(server, "tools/list")) as {
      tools: Array<{ name: string; description: string; inputSchema: unknown }>;
    };
    expect(result.tools.map((t) => t.name)).toEqual(["vector_search", "fetch_url"]);
    expect(result.tools[0].description).toContain("vector_search");
    expect(result.tools[0].inputSchema).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
    });
  });

  it("delegates tools/call to the registered tool and wraps the output", async () => {
    const execute = jest.fn().mockResolvedValue({
      success: true,
      output: "found 3 chunks",
    });
    registry.register(makeTool("vector_search", { success: true, output: "" }, execute));
    const svc = new McpService(registry);
    const server = svc.createServer();
    const result = (await invoke(server, "tools/call", {
      name: "vector_search",
      arguments: { query: "VPN" },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(execute).toHaveBeenCalledWith({ query: "VPN" });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "found 3 chunks" }]);
  });

  it("returns isError=true and an error message for unknown tools", async () => {
    const svc = new McpService(registry);
    const server = svc.createServer();
    const result = (await invoke(server, "tools/call", {
      name: "unknown",
      arguments: {},
    })) as { isError: boolean; content: Array<{ type: string; text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
  });

  it("returns isError=true and message when the tool throws", async () => {
    const execute = jest.fn().mockRejectedValue(new Error("boom"));
    registry.register(makeTool("vector_search", { success: true, output: "" }, execute));
    const svc = new McpService(registry);
    const server = svc.createServer();
    const result = (await invoke(server, "tools/call", {
      name: "vector_search",
      arguments: {},
    })) as { isError: boolean; content: Array<{ type: string; text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });
});
