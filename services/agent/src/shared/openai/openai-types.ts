import { z } from "zod";
import { LlmTokenUsage } from "../llm/llm.types";

export const ChatCompletionMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export const ChatCompletionRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(ChatCompletionMessageSchema).min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionMessage = z.infer<typeof ChatCompletionMessageSchema>;

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    message: { role: "assistant"; content: string };
    finish_reason: "stop";
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: { role?: "assistant"; content?: string };
    finish_reason: "stop" | null;
  }>;
}

export function createCompletionResponse(
  content: string,
  model: string,
  usage?: LlmTokenUsage,
  id: string = `chatcmpl-${Date.now()}`,
): ChatCompletionResponse {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: usage
      ? {
          prompt_tokens: usage.inputTokens,
          completion_tokens: usage.outputTokens,
          total_tokens: usage.inputTokens + usage.outputTokens,
        }
      : undefined,
  };
}

export function createCompletionChunk(
  id: string,
  delta: string | null,
  finishReason: "stop" | null,
  model: string,
): ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: delta !== null ? { content: delta } : {},
        finish_reason: finishReason,
      },
    ],
  };
}
