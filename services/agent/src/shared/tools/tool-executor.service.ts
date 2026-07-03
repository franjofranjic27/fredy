import { Injectable, Logger } from "@nestjs/common";
import { SpanStatusCode, trace, Tracer } from "@opentelemetry/api";
import { ObservabilityService } from "../observability/observability.service";
import { setToolAttrs } from "../observability/semconv";
import {
  ToolDefinition,
  ToolError,
  ToolErrorCode,
  ToolResult,
  ToolContext,
} from "./tool.interface";
import { ToolRegistryService } from "./tool-registry.service";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ToolExecutorRunOptions {
  timeoutMs?: number;
  callId?: string;
}

export type ToolExecutorOutcome<T = unknown> =
  | { ok: true; result: ToolResult<T> }
  | { ok: false; error: ToolError };

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);
  private readonly tracer: Tracer = trace.getTracer("fredy-agent.tool-executor");

  constructor(
    private readonly registry: ToolRegistryService,
    // observability service kept available for future structured logs
    // (current implementation only uses the OTel tracer + Nest logger)
    private readonly _observability: ObservabilityService,
  ) {}

  async run<T = unknown>(
    name: string,
    rawInput: unknown,
    ctx: ToolContext,
    opts: ToolExecutorRunOptions = {},
  ): Promise<ToolExecutorOutcome<T>> {
    const tool = this.registry.getTool(name) as ToolDefinition<unknown, T> | undefined;
    if (!tool) {
      return this.fail({
        code: "not_found",
        message: `Tool "${name}" is not registered`,
        retryable: false,
      });
    }

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      );
      return this.fail({
        code: "schema_invalid",
        message: `Invalid input for "${name}": ${issues.join("; ")}`,
        retryable: false,
        cause: parsed.error,
      });
    }

    const span = this.tracer.startSpan("gen_ai.tool.execute");
    if (tool.staticAttributes) {
      for (const [key, value] of Object.entries(tool.staticAttributes)) {
        span.setAttribute(key, value);
      }
    }
    span.setAttribute("request.id", ctx.requestId);
    if (ctx.agentId) span.setAttribute("agent.id", ctx.agentId);

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const result = await this.withTimeout(
        tool.execute(parsed.data as unknown, ctx),
        timeoutMs,
        name,
      );
      setToolAttrs(span, {
        name,
        callId: opts.callId,
        success: true,
        input: parsed.data,
        output: result.data ?? result.output,
      });
      span.setStatus({ code: SpanStatusCode.OK });
      return { ok: true, result };
    } catch (err) {
      const error = this.mapError(err, name);
      setToolAttrs(span, {
        name,
        callId: opts.callId,
        success: false,
        input: parsed.data,
      });
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      this.logger.error(`tool ${name} failed [${error.code}]: ${error.message}`);
      return { ok: false, error };
    } finally {
      span.end();
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new ToolError({
            code: "timeout",
            message: `Tool "${name}" exceeded ${timeoutMs}ms timeout`,
            retryable: true,
          }),
        );
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private mapError(err: unknown, name: string): ToolError {
    if (err instanceof ToolError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new ToolError({
      code: "internal",
      message: `Tool "${name}" threw: ${message}`,
      retryable: false,
      cause: err,
    });
  }

  private fail<T>(params: {
    code: ToolErrorCode;
    message: string;
    retryable: boolean;
    cause?: unknown;
  }): ToolExecutorOutcome<T> {
    return { ok: false, error: new ToolError(params) };
  }
}
