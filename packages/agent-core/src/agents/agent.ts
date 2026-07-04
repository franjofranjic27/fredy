export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface AgentUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AgentRunInput {
  /** Correlation id echoed back to the client (x-session-id). */
  readonly sessionId: string;
  /** Full conversation history as sent by the client (Open-WebUI sends everything per request). */
  readonly messages: readonly ChatMessage[];
  /** Content of the latest user message. */
  readonly userMessage: string;
  /** Tool names permitted for this request; undefined means unrestricted. */
  readonly allowedToolNames?: readonly string[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  /**
   * Aborts in-flight LLM/tool calls when the client disconnects, so cancelled
   * requests stop costing tokens. Propagate into every downstream call.
   */
  readonly signal?: AbortSignal;
}

export interface AgentRunResult {
  readonly content: string;
  readonly model: string;
  readonly usage?: AgentUsage;
}

/**
 * Streaming protocol: any number of `delta` events followed by exactly one
 * terminal `done` event carrying usage/model metadata (when the underlying
 * provider reports it) — mirrors OpenAI's `stream_options.include_usage`.
 */
export type AgentStreamEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done"; readonly usage?: AgentUsage; readonly model?: string };

/** A ready-to-serve agent instance bound to its dependencies. */
export interface AgentRun {
  invoke(input: AgentRunInput): Promise<AgentRunResult>;
  /** Streams answer deltas, terminated by a single `done` event. */
  stream(input: AgentRunInput): AsyncIterable<AgentStreamEvent>;
}

/**
 * Blueprint of an agent. `createRun` binds the shared infrastructure
 * (config, tools, models) once at boot; the returned run serves requests.
 */
export interface AgentDefinition<TDeps = unknown> {
  readonly id: string;
  readonly ownedBy?: string;
  createRun(deps: TDeps): AgentRun;
}
