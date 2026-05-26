export type LlmMessageRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCompletionStreamRequest extends LlmCompletionRequest {
  stream: true;
}

export interface LlmTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCompletionResponse {
  content: string;
  model: string;
  responseId?: string;
  finishReason?: string;
  usage?: LlmTokenUsage;
}

export interface LlmStreamChunk {
  id: string;
  delta: string;
  finishReason?: string;
  usage?: LlmTokenUsage;
  responseId?: string;
}

export interface LlmModelInfo {
  id: string;
  object: "model";
  owned_by: string;
}

export type LlmErrorCode =
  | "RATE_LIMITED"
  | "API_ERROR"
  | "UNAUTHORIZED"
  | "MODEL_NOT_FOUND"
  | "TIMEOUT";

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
