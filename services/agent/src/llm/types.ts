export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage?: TokenUsage;
}

export interface LLMClient {
  chat(
    messages: Message[],
    tools?: ToolDefinition[],
    onDelta?: (delta: string) => Promise<void> | void,
  ): Promise<LLMResponse>;
}
