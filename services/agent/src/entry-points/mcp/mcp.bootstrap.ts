import "reflect-metadata";
import "../../tracing-init";

import { NestFactory } from "@nestjs/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpAppModule } from "./mcp-app.module";
import { McpService } from "./mcp.service";

async function main(): Promise<void> {
  // The MCP protocol uses stdout for JSON-RPC messages. Any other writes to
  // stdout would corrupt the framing, so silence Nest's own logger entirely.
  const app = await NestFactory.createApplicationContext(McpAppModule, {
    logger: false,
  });

  try {
    const mcp = app.get(McpService);
    const server = mcp.createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Block forever — the transport keeps the process alive.
    await new Promise<void>((resolve) => {
      process.on("SIGINT", resolve);
      process.on("SIGTERM", resolve);
    });
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  // Stderr is safe; stdout is reserved for the MCP transport.
  process.stderr.write(`MCP bootstrap failed: ${String(error)}\n`);
  process.exit(1);
});
