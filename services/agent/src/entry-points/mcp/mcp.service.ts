import { Injectable, Logger } from "@nestjs/common";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { ToolExecutorService } from "../../shared/tools/tool-executor.service";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";

const SERVER_NAME = "fredy-agent-mcp";
const SERVER_VERSION = "0.1.0";

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolExecutor: ToolExecutorService,
  ) {}

  createServer(): Server {
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.toolRegistry.getDescriptions().map((d) => ({
        name: d.name,
        description: d.description,
        inputSchema: d.parametersJsonSchema as {
          type: "object";
          properties?: Record<string, unknown>;
        },
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const requestId = `mcp-${randomUUID()}`;
      const outcome = await this.toolExecutor.run(name, args ?? {}, {
        requestId,
        agentId: "mcp-bridge",
      });
      if (outcome.ok) {
        return {
          isError: false,
          content: [{ type: "text", text: outcome.result.output }],
        };
      }
      this.logger.warn(
        `tool ${name} via MCP failed [${outcome.error.code}]: ${outcome.error.message}`,
      );
      return {
        isError: true,
        content: [{ type: "text", text: `[${outcome.error.code}] ${outcome.error.message}` }],
      };
    });

    return server;
  }
}
