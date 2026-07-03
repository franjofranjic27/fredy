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

export interface RetrievalEvent extends BaseLogEvent {
  type: "retrieval";
  query: string;
  resultCount: number;
  chunks?: Array<{ id: string; score?: number; url?: string; title?: string }>;
  durationMs?: number;
  error?: { code: string; message: string };
}

export interface LlmCallEvent extends BaseLogEvent {
  type: "llm-call";
  provider: "anthropic" | "openai" | "google.gemini";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
  durationMs?: number;
}

export interface ToolCallEvent extends BaseLogEvent {
  type: "tool-call";
  toolName: string;
  success: boolean;
  durationMs?: number;
  errorMessage?: string;
}

export type AgentLogEvent = RequestLogEvent | RetrievalEvent | LlmCallEvent | ToolCallEvent;
