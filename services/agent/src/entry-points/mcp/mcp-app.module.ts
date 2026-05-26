import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { WinstonModule } from "nest-winston";
import configuration from "../../config/configuration";
import { observabilityLoggerOptions } from "../../shared/observability/logger.factory";
import { McpModule } from "./mcp.module";

/**
 * Minimal root module for the MCP stdio entry point.
 *
 * The HTTP-only modules (auth/guards, rate-limit interceptor, web controller,
 * rag-agent orchestration) are intentionally omitted — MCP clients drive tools
 * directly without going through the chat-completion pipeline.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    WinstonModule.forRoot(observabilityLoggerOptions),
    McpModule,
  ],
})
export class McpAppModule {}
