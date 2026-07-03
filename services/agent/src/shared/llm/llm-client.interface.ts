import { Observable } from "rxjs";
import {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmCompletionStreamRequest,
  LlmModelInfo,
  LlmStreamChunk,
} from "./llm.types";

export type LlmProviderId = "anthropic" | "openai" | "google.gemini";

export interface LlmClient {
  readonly providerId: LlmProviderId;
  supportsModel(modelId: string): boolean;
  createCompletion(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
  createCompletionStream(request: LlmCompletionStreamRequest): Observable<LlmStreamChunk>;
  listModels(): Promise<LlmModelInfo[]>;
}
