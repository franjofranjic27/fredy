import type { Logger } from "@fredy/agent-core";

export type AgentName = "rag-agent";

export interface BaseLogEvent {
  type: string;
  agent: AgentName;
  sessionId?: string;
  requestId?: string;
  model?: string;
}

export interface RequestLogEvent extends BaseLogEvent {
  type: "request";
  sessionId: string;
  model: string;
  durationMs?: number;
  finishReason?: "stop" | "error" | "fallback";
  error?: string;
}

export interface RetrievalLogEvent extends BaseLogEvent {
  type: "retrieval";
  query: string;
  resultCount: number;
  chunks?: Array<{ id: string; score?: number; url?: string; title?: string }>;
  durationMs?: number;
  error?: { code: string; message: string };
}

export interface LlmCallLogEvent extends BaseLogEvent {
  type: "llm-call";
  provider: "anthropic" | "openai" | "google.gemini";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
  durationMs?: number;
}

export type AgentLogEvent = RequestLogEvent | RetrievalLogEvent | LlmCallLogEvent;

/**
 * Emits a structured audit event through pino. Timestamp, service, env and
 * host come from the shared logger (agent-core base fields) — this wrapper
 * only adds the typed event shape.
 */
export function emitLogEvent(logger: Logger, event: AgentLogEvent): void {
  logger.info(event);
}
