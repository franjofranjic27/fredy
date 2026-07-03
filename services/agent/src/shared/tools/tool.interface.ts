import type { AttributeValue } from "@opentelemetry/api";
import type { ZodType } from "zod";

export interface ToolChunkMetadata {
  id: string;
  score?: number;
  url?: string;
  title?: string;
  spaceKey?: string;
}

export interface ToolResult<TOutput = unknown> {
  output: string;
  data?: TOutput;
  metadata?: {
    chunks?: ToolChunkMetadata[];
  };
}

export type ToolErrorCode =
  | "schema_invalid"
  | "timeout"
  | "upstream_error"
  | "unauthorized"
  | "not_found"
  | "internal";

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(params: {
    code: ToolErrorCode;
    message: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "ToolError";
    this.code = params.code;
    this.retryable = params.retryable ?? false;
    this.cause = params.cause;
  }
}

export interface ToolContext {
  requestId: string;
  sessionId?: string;
  agentId?: string;
  signal?: AbortSignal;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<TInput>;
  /**
   * Static OTel attributes attached to every tool span (e.g. db.system, db.collection.name).
   * Set in the constructor once the providers behind the tool are known.
   */
  readonly staticAttributes?: Record<string, AttributeValue>;
  execute(input: TInput, ctx: ToolContext): Promise<ToolResult<TOutput>>;
}

/**
 * View model rendered by the registry — used by the MCP entry-point and the
 * tool-formatter prompt helper. The `parametersJsonSchema` is derived from
 * `ToolDefinition.inputSchema` via `z.toJSONSchema()`.
 */
export interface ToolDescription {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}
