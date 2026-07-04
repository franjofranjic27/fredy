import { hostname } from "node:os";
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

const host = hostname();

/**
 * Emits a structured audit event through pino, enriched with the same
 * timestamp/service/env/host fields the previous ObservabilityService added.
 */
export function emitLogEvent(logger: Logger, event: AgentLogEvent): void {
  logger.info({
    timestamp: new Date().toISOString(),
    service: process.env.SERVICE_NAME ?? "fredy-agent",
    env: process.env.PROJECT_ENV ?? "development",
    host,
    ...event,
  });
}
