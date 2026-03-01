import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createToolRegistry } from "../setup.js";
import type { ToolRegistry } from "../tools/index.js";

export function createMcpServer(registry: ToolRegistry = createToolRegistry()): McpServer {
  const server = new McpServer({ name: "fredy-tools", version: "0.1.0" });

  for (const name of registry.list()) {
    const tool = registry.get(name)!;

    if (!(tool.inputSchema instanceof z.ZodObject)) {
      console.error(`[mcp-server] Skipping tool "${name}": inputSchema is not a ZodObject`);
      continue;
    }

    server.tool(name, tool.description, tool.inputSchema.shape, async (args) => {
      try {
        const result = await registry.execute(name, args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  return server;
}

// Entrypoint — only executes when run directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const transport = new StdioServerTransport();
  await createMcpServer().connect(transport);
  console.error("Fredy MCP Server running on stdio");
}
