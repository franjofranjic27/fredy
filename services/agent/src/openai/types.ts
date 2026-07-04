import { z } from "zod";
import type { AgentUsage } from "@fredy/agent-core";

export const ChatCompletionMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export const ChatCompletionRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(ChatCompletionMessageSchema).min(1),
  stream: z.boolean().optional().default(false),
  stream_options: z.object({ include_usage: z.boolean().optional() }).optional(),
  // OpenAI range; providers with a narrower range (Anthropic 0–1) clamp downstream.
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
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

export interface ChatCompletionChunkDelta {
  role?: "assistant";
  content?: string;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: ChatCompletionChunkDelta;
    finish_reason: "stop" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function createCompletionResponse(
  content: string,
  model: string,
  usage?: AgentUsage,
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
  delta: ChatCompletionChunkDelta,
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
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

/**
 * Terminal usage chunk per OpenAI's `stream_options.include_usage` contract:
 * sent after the finish_reason chunk with an empty choices array.
 */
export function createUsageChunk(
  id: string,
  model: string,
  usage: AgentUsage,
): Omit<ChatCompletionChunk, "choices"> & { choices: [] } {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [],
    usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
    },
  };
}
