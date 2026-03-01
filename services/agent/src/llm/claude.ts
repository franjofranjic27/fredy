import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient, Message, ToolDefinition, LLMResponse } from "./types.js";
import { LlmError } from "./types.js";

export interface ClaudeClientOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createClaudeClient(options: ClaudeClientOptions): LLMClient {
  const {
    apiKey,
    model = "claude-sonnet-4-20250514",
    maxTokens = 4096,
    maxRetries,
    timeoutMs,
  } = options;

  const client = new Anthropic({
    apiKey,
    maxRetries: maxRetries ?? 3,
    timeout: timeoutMs ?? 120_000,
  });

  return {
    async chat(
      messages: Message[],
      tools?: ToolDefinition[],
      onDelta?: (delta: string) => Promise<void> | void,
    ): Promise<LLMResponse> {
      const systemMessage = messages.find((m) => m.role === "system");
      const chatMessages = buildMessages(messages);

      const toolParams = tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
      }));

      try {
        const params: Anthropic.MessageCreateParamsNonStreaming = {
          model,
          max_tokens: maxTokens,
          system: systemMessage?.content,
          messages: chatMessages,
          tools: toolParams,
        };
        const response = await callLlm(client, params, onDelta);

        const textContent = response.content.find((c) => c.type === "text");
        const toolUseBlocks = response.content.filter(
          (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
        );

        return {
          content: textContent?.type === "text" ? textContent.text : null,
          toolCalls: toolUseBlocks.map((t) => ({
            id: t.id,
            name: t.name,
            arguments: t.input as Record<string, unknown>,
          })),
          stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        };
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          if (error.status === 429) {
            throw new LlmError("RATE_LIMITED", "Rate limit exceeded", error);
          }
          throw new LlmError("API_ERROR", `Anthropic API error: ${error.status}`, error);
        }
        throw error;
      }
    },
  };
}

async function callLlm(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  onDelta?: (delta: string) => Promise<void> | void,
): Promise<Anthropic.Message> {
  if (onDelta) {
    const stream = client.messages.stream(params);
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        await onDelta(event.delta.text);
      }
    }
    return stream.finalMessage();
  }
  return client.messages.create(params);
}

function buildMessages(messages: Message[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    result.push({
      role: msg.role,
      content: msg.content,
    });
  }

  return result;
}
