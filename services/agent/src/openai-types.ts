import { z } from "zod";

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

export function createCompletionResponse(
  content: string,
  model: string
) {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content },
        finish_reason: "stop" as const,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function createCompletionChunk(
  id: string,
  content: string | null,
  finishReason: "stop" | null,
  model: string
) {
  return {
    id,
    object: "chat.completion.chunk" as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: content !== null ? { content } : {},
        finish_reason: finishReason,
      },
    ],
  };
}
