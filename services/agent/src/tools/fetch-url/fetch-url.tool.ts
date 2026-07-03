import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  ToolContext,
  ToolDefinition,
  ToolError,
  ToolResult,
} from "../../shared/tools/tool.interface";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { fetchUrlInputSchema, FetchUrlInput } from "./fetch-url.schema";

const DEFAULT_MAX_CHARS = 4000;

@Injectable()
export class FetchUrlTool
  implements ToolDefinition<FetchUrlInput, { status: number; body: string }>, OnModuleInit
{
  readonly name = "fetch_url";
  readonly description =
    "Fetch the textual contents of a public URL (HTML or plain text). Useful when the user pastes a link and asks for a summary or asks you to consult an external source. Long responses are truncated to ~4000 characters.";
  readonly inputSchema = fetchUrlInputSchema;

  constructor(private readonly registry: ToolRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    input: FetchUrlInput,
    ctx: ToolContext,
  ): Promise<ToolResult<{ status: number; body: string }>> {
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
    let response: Response;
    try {
      response = await fetch(input.url, { redirect: "follow", signal: ctx.signal });
    } catch (err) {
      throw new ToolError({
        code: "upstream_error",
        message: `Failed to fetch ${input.url}: ${err instanceof Error ? err.message : String(err)}`,
        retryable: true,
        cause: err,
      });
    }

    const text = await response.text();
    const truncated = text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;

    if (!response.ok) {
      throw new ToolError({
        code: "upstream_error",
        message: `HTTP ${response.status} from ${input.url}`,
        retryable: response.status >= 500,
      });
    }

    return {
      output: truncated,
      data: { status: response.status, body: truncated },
    };
  }
}
