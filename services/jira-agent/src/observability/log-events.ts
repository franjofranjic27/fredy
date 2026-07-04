import type { Logger } from "@fredy/agent-core";

export type AgentName = "jira-agent";

export interface BaseLogEvent {
  type: string;
  agent: AgentName;
  issueKey?: string;
  requestId?: string;
}

export interface TicketEventLog extends BaseLogEvent {
  type: "ticket-event";
  issueKey: string;
  trigger: "assigned" | "reprocess";
  clarificationRounds?: number;
}

export interface ClassificationLog extends BaseLogEvent {
  type: "classification";
  path: string;
  confidence: number;
  language?: string;
  retrievalRounds?: number;
  /** Truncated — reasoning is audit context, not payload. */
  reasoning?: string;
  coercedFrom?: string;
}

export interface CacheLookupLog extends BaseLogEvent {
  type: "cache-lookup";
  resultCount: number;
  topScore?: number;
  strong?: boolean;
  durationMs?: number;
}

export interface RetrievalLog extends BaseLogEvent {
  type: "retrieval";
  /** Truncated to keep PII/bloat out of the logs. */
  query: string;
  resultCount: number;
  chunks?: Array<{ id: string; score?: number; url?: string }>;
  durationMs?: number;
}

export interface LlmCallLog extends BaseLogEvent {
  type: "llm-call";
  purpose: "classify" | "answer" | "clarification";
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}

export interface JiraActionLog extends BaseLogEvent {
  type: "jira-action";
  issueKey: string;
  action: "addComment" | "assignIssue" | "transition";
  detail?: string;
  skipped?: boolean;
}

export interface CacheWriteLog extends BaseLogEvent {
  type: "cache-write";
  issueKey: string;
  cacheKey: string;
}

export type AgentLogEvent =
  | TicketEventLog
  | ClassificationLog
  | CacheLookupLog
  | RetrievalLog
  | LlmCallLog
  | JiraActionLog
  | CacheWriteLog;

const LOG_TEXT_LIMIT = 200;

export function truncateForLog(text: string, limit: number = LOG_TEXT_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/**
 * Emits a structured audit event through pino. Timestamp, service, env and
 * host come from the shared logger (agent-core base fields) — this wrapper
 * only adds the typed event shape.
 */
export function emitLogEvent(logger: Logger, event: AgentLogEvent): void {
  logger.info(event);
}
