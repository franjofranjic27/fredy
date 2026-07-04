import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import type { Serialized } from "@langchain/core/load/serializable";
import { Span, SpanStatusCode, trace, Tracer } from "@opentelemetry/api";
import {
  addLlmContentEvent,
  GEN_AI,
  safeStringify,
  setLlmRequestAttrs,
  setLlmResponseAttrs,
  setToolAttrs,
  TOOL,
} from "./semconv.js";

const DEFAULT_TRACER_NAME = "fredy.langchain";

interface UsageTokens {
  inputTokens?: number;
  outputTokens?: number;
}

interface ChatGenerationLike {
  text?: string;
  generationInfo?: Record<string, unknown>;
  message?: {
    usage_metadata?: unknown;
    response_metadata?: Record<string, unknown>;
  };
}

/**
 * LangChain callback handler that maps LLM and tool runs onto OpenTelemetry
 * spans following the GenAI semantic conventions. Message and tool content is
 * only recorded when OTEL_GENAI_CAPTURE_CONTENT=true.
 */
export class OtelCallbackHandler extends BaseCallbackHandler {
  readonly name = "fredy-otel-callback";

  private readonly tracer: Tracer;
  private readonly llmSpans = new Map<string, Span>();
  private readonly toolSpans = new Map<string, Span>();

  constructor(tracerName: string = DEFAULT_TRACER_NAME) {
    super();
    this.tracer = trace.getTracer(tracerName);
  }

  override async handleChatModelStart(
    _llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): Promise<void> {
    const span = this.tracer.startSpan("gen_ai.chat");
    const requestModel = extractRequestModel(extraParams);
    if (requestModel) {
      setLlmRequestAttrs(span, {
        model: requestModel,
        maxTokens: extractInvocationNumber(extraParams, ["max_tokens", "maxTokens"]),
        temperature: extractInvocationNumber(extraParams, ["temperature"]),
      });
    } else {
      span.setAttribute(GEN_AI.OPERATION_NAME, "chat");
    }
    for (const message of messages.flat()) {
      addLlmContentEvent(span, roleOf(message), contentToString(message.content));
    }
    this.llmSpans.set(runId, span);
  }

  override async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const span = this.llmSpans.get(runId);
    if (!span) return;
    this.llmSpans.delete(runId);

    const generation = output.generations?.[0]?.[0] as ChatGenerationLike | undefined;
    const usage = extractUsage(output, generation);
    setLlmResponseAttrs(span, {
      responseModel: extractResponseModel(output, generation),
      finishReasons: extractFinishReasons(output),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    if (generation?.text) {
      addLlmContentEvent(span, "assistant", generation.text);
    }
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  override async handleLLMError(error: unknown, runId: string): Promise<void> {
    const span = this.llmSpans.get(runId);
    if (!span) return;
    this.llmSpans.delete(runId);
    endSpanWithError(span, error);
  }

  override async handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void> {
    const span = this.tracer.startSpan("gen_ai.tool.execute");
    const toolName = runName ?? tool.id[tool.id.length - 1] ?? "unknown";
    setToolAttrs(span, { name: String(toolName), success: true, input });
    this.toolSpans.set(runId, span);
  }

  override async handleToolEnd(output: unknown, runId: string): Promise<void> {
    const span = this.toolSpans.get(runId);
    if (!span) return;
    this.toolSpans.delete(runId);
    span.setAttribute(TOOL.SUCCESS, true);
    if (process.env.OTEL_GENAI_CAPTURE_CONTENT === "true") {
      span.setAttribute(TOOL.OUTPUT, safeStringify(toolOutputToString(output)));
    }
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  override async handleToolError(error: unknown, runId: string): Promise<void> {
    const span = this.toolSpans.get(runId);
    if (!span) return;
    this.toolSpans.delete(runId);
    span.setAttribute(TOOL.SUCCESS, false);
    endSpanWithError(span, error);
  }

  /**
   * Ends any spans still open (e.g. an SSE client disconnected mid-stream so
   * handleLLMEnd never fired) as cancelled and clears the maps, so spans and map
   * entries never leak. Idempotent.
   */
  endOpenSpans(): void {
    for (const span of this.llmSpans.values()) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "cancelled" });
      span.end();
    }
    this.llmSpans.clear();
    for (const span of this.toolSpans.values()) {
      span.setAttribute(TOOL.SUCCESS, false);
      span.setStatus({ code: SpanStatusCode.ERROR, message: "cancelled" });
      span.end();
    }
    this.toolSpans.clear();
  }
}

function endSpanWithError(span: Span, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  span.recordException(error instanceof Error ? error : new Error(message));
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.end();
}

function invocationParamsOf(
  extraParams?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const invocationParams = extraParams?.invocation_params;
  if (!invocationParams || typeof invocationParams !== "object") return undefined;
  return invocationParams as Record<string, unknown>;
}

function extractRequestModel(extraParams?: Record<string, unknown>): string | undefined {
  const params = invocationParamsOf(extraParams);
  if (!params) return undefined;
  const model = params.model ?? params.model_name ?? params.modelName;
  return typeof model === "string" ? model : undefined;
}

function extractInvocationNumber(
  extraParams: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined {
  const params = invocationParamsOf(extraParams);
  if (!params) return undefined;
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

function extractUsage(output: LLMResult, generation: ChatGenerationLike | undefined): UsageTokens {
  const llmOutput = output.llmOutput ?? {};

  const tokenUsage = llmOutput.tokenUsage as Record<string, unknown> | undefined;
  if (tokenUsage) {
    return {
      inputTokens: asNumber(tokenUsage.promptTokens),
      outputTokens: asNumber(tokenUsage.completionTokens),
    };
  }

  const usage = llmOutput.usage as Record<string, unknown> | undefined;
  if (usage) {
    return {
      inputTokens: asNumber(usage.input_tokens),
      outputTokens: asNumber(usage.output_tokens),
    };
  }

  const usageMetadata = generation?.message?.usage_metadata as Record<string, unknown> | undefined;
  if (usageMetadata) {
    return {
      inputTokens: asNumber(usageMetadata.input_tokens),
      outputTokens: asNumber(usageMetadata.output_tokens),
    };
  }

  return {};
}

function extractResponseModel(
  output: LLMResult,
  generation: ChatGenerationLike | undefined,
): string | undefined {
  const fromLlmOutput = (output.llmOutput as Record<string, unknown> | undefined)?.model_name;
  if (typeof fromLlmOutput === "string") return fromLlmOutput;
  const metadata = generation?.message?.response_metadata;
  const fromMetadata = metadata?.model ?? metadata?.model_name;
  return typeof fromMetadata === "string" ? fromMetadata : undefined;
}

function extractFinishReasons(output: LLMResult): string[] {
  const reasons = new Set<string>();
  for (const generations of output.generations ?? []) {
    for (const generation of generations) {
      const info = generation.generationInfo;
      const reason = info?.finish_reason ?? info?.stop_reason;
      if (typeof reason === "string") reasons.add(reason);
    }
  }
  return [...reasons];
}

function roleOf(message: BaseMessage): "user" | "assistant" | "system" | "tool" {
  switch (message.getType()) {
    case "human":
      return "user";
    case "ai":
      return "assistant";
    case "system":
      return "system";
    case "tool":
      return "tool";
    default:
      return "user";
  }
}

export function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          const text = (block as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function toolOutputToString(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "content" in output) {
    return contentToString((output as { content: unknown }).content);
  }
  return safeStringify(output);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
