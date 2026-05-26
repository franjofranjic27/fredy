import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { trace, Tracer } from "@opentelemetry/api";
import { GEN_AI, setToolAttrs } from "../../shared/observability/semconv";
import { Tool, ToolResult } from "../../shared/tools/tool.interface";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";

interface FetchUrlInput {
  url: string;
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 4000;

@Injectable()
export class FetchUrlTool
  implements Tool<FetchUrlInput, { status: number; body: string }>, OnModuleInit
{
  readonly description = {
    name: "fetch_url",
    description:
      "Fetch the textual contents of a public URL (HTML or plain text). Useful when the user pastes a link and asks for a summary or asks you to consult an external source. Long responses are truncated to ~4000 characters.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Fully qualified HTTP(S) URL." },
        maxChars: {
          type: "number",
          description: "Maximum characters to return from the response body.",
        },
      },
      required: ["url"],
    },
  };

  private readonly logger = new Logger(FetchUrlTool.name);
  private readonly tracer: Tracer = trace.getTracer("fredy-agent.fetch-url");

  constructor(private readonly registry: ToolRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(input: FetchUrlInput): Promise<ToolResult<{ status: number; body: string }>> {
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
    const span = this.tracer.startSpan("gen_ai.tool.execute");
    span.setAttribute(GEN_AI.TOOL_NAME, this.description.name);

    try {
      if (!/^https?:\/\//i.test(input.url)) {
        throw new Error("URL must start with http:// or https://");
      }
      const response = await fetch(input.url, { redirect: "follow" });
      const text = await response.text();
      const truncated =
        text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
      setToolAttrs(span, {
        name: this.description.name,
        success: response.ok,
        input: { url: input.url, maxChars },
        output: { status: response.status, length: truncated.length },
      });
      return {
        success: response.ok,
        output: truncated,
        data: { status: response.status, body: truncated },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`fetch_url failed: ${message}`);
      setToolAttrs(span, {
        name: this.description.name,
        success: false,
        input: { url: input.url, maxChars },
      });
      span.recordException(error instanceof Error ? error : new Error(message));
      return { success: false, output: `Failed to fetch ${input.url}: ${message}` };
    } finally {
      span.end();
    }
  }
}
