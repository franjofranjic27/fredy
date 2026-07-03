import { Span } from "@opentelemetry/api";

export const GEN_AI = {
  SYSTEM: "gen_ai.system",
  REQUEST_MODEL: "gen_ai.request.model",
  REQUEST_MAX_TOKENS: "gen_ai.request.max_tokens",
  REQUEST_TEMPERATURE: "gen_ai.request.temperature",
  RESPONSE_ID: "gen_ai.response.id",
  RESPONSE_MODEL: "gen_ai.response.model",
  RESPONSE_FINISH_REASONS: "gen_ai.response.finish_reasons",
  USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  TOOL_NAME: "gen_ai.tool.name",
  TOOL_CALL_ID: "gen_ai.tool.call.id",
  OPERATION_NAME: "gen_ai.operation.name",
  RETRIEVAL_QUERY: "gen_ai.retrieval.query",
  RETRIEVAL_RESULT_COUNT: "gen_ai.retrieval.result_count",
  RETRIEVAL_DURATION_MS: "gen_ai.retrieval.duration_ms",
} as const;

export const AGENT = {
  NAME: "agent.name",
  SESSION_ID: "agent.session_id",
  ITERATIONS: "agent.iterations",
} as const;

export const TOOL = {
  INPUT: "tool.input",
  OUTPUT: "tool.output",
  SUCCESS: "tool.success",
} as const;

export const DB = {
  SYSTEM: "db.system",
  COLLECTION_NAME: "db.collection.name",
} as const;

export type LlmSystem = "anthropic" | "openai" | "google.gemini";

/**
 * Returns true when the OTEL_GENAI_CAPTURE_CONTENT env flag is enabled.
 * Content capture is OFF by default to avoid leaking prompts and outputs into traces.
 */
export function captureContent(): boolean {
  return process.env.OTEL_GENAI_CAPTURE_CONTENT === "true";
}

export interface LlmRequestAttrs {
  system: LlmSystem;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export function setLlmRequestAttrs(span: Span, attrs: LlmRequestAttrs): void {
  span.setAttribute(GEN_AI.SYSTEM, attrs.system);
  span.setAttribute(GEN_AI.REQUEST_MODEL, attrs.model);
  span.setAttribute(GEN_AI.OPERATION_NAME, "chat");
  if (typeof attrs.maxTokens === "number") {
    span.setAttribute(GEN_AI.REQUEST_MAX_TOKENS, attrs.maxTokens);
  }
  if (typeof attrs.temperature === "number") {
    span.setAttribute(GEN_AI.REQUEST_TEMPERATURE, attrs.temperature);
  }
}

export interface LlmResponseAttrs {
  responseId?: string;
  responseModel?: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function setLlmResponseAttrs(span: Span, attrs: LlmResponseAttrs): void {
  if (attrs.responseId) span.setAttribute(GEN_AI.RESPONSE_ID, attrs.responseId);
  if (attrs.responseModel) span.setAttribute(GEN_AI.RESPONSE_MODEL, attrs.responseModel);
  if (attrs.finishReason) span.setAttribute(GEN_AI.RESPONSE_FINISH_REASONS, [attrs.finishReason]);
  if (typeof attrs.inputTokens === "number")
    span.setAttribute(GEN_AI.USAGE_INPUT_TOKENS, attrs.inputTokens);
  if (typeof attrs.outputTokens === "number")
    span.setAttribute(GEN_AI.USAGE_OUTPUT_TOKENS, attrs.outputTokens);
}

export interface ToolAttrs {
  name: string;
  callId?: string;
  success: boolean;
  input?: unknown;
  output?: unknown;
}

export function setToolAttrs(span: Span, attrs: ToolAttrs): void {
  span.setAttribute(GEN_AI.TOOL_NAME, attrs.name);
  span.setAttribute(GEN_AI.OPERATION_NAME, "execute_tool");
  span.setAttribute(TOOL.SUCCESS, attrs.success);
  if (attrs.callId) span.setAttribute(GEN_AI.TOOL_CALL_ID, attrs.callId);
  if (captureContent()) {
    if (attrs.input !== undefined) span.setAttribute(TOOL.INPUT, safeStringify(attrs.input));
    if (attrs.output !== undefined) span.setAttribute(TOOL.OUTPUT, safeStringify(attrs.output));
  }
}

export function addLlmContentEvent(
  span: Span,
  role: "user" | "assistant" | "system",
  content: string,
): void {
  if (!captureContent()) return;
  span.addEvent(`gen_ai.${role}.message`, { content });
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}
