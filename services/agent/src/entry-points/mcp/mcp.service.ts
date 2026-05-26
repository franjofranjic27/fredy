import { Injectable, Logger } from "@nestjs/common";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";

const SERVER_NAME = "fredy-agent-mcp";
const SERVER_VERSION = "0.1.0";

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(private readonly toolRegistry: ToolRegistryService) {}

  createServer(): Server {
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.toolRegistry.getAllTools().map((tool) => ({
        name: tool.description.name,
        description: tool.description.description,
        inputSchema: tool.description.parametersJsonSchema as {
          type: "object";
          properties?: Record<string, unknown>;
        },
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = this.toolRegistry.getTool(name);
      if (!tool) {
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
        };
      }
      try {
        const result = await tool.execute((args ?? {}) as Record<string, unknown>);
        return {
          isError: !result.success,
          content: [{ type: "text", text: result.output }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Tool ${name} failed: ${message}`);
        return {
          isError: true,
          content: [{ type: "text", text: `Tool error: ${message}` }],
        };
      }
    });

    return server;
  }
}
