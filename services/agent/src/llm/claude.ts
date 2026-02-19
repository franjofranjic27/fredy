import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMClient,
  Message,
  ToolDefinition,
  LLMResponse,
} from "./types.js";

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

      let response: Anthropic.Message;

      if (onDelta) {
        const stream = client.messages.stream({
          model,
          max_tokens: maxTokens,
          system: systemMessage?.content,
          messages: chatMessages,
          tools: toolParams,
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            await onDelta(event.delta.text);
          }
        }

        response = await stream.finalMessage();
      } else {
        response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system: systemMessage?.content,
          messages: chatMessages,
          tools: toolParams,
        });
      }

      const textContent = response.content.find((c) => c.type === "text");
      const toolUseBlocks = response.content.filter((c) => c.type === "tool_use");

      return {
        content: textContent?.type === "text" ? textContent.text : null,
        toolCalls: toolUseBlocks.map((t) => ({
          id: t.type === "tool_use" ? t.id : "",
          name: t.type === "tool_use" ? t.name : "",
          arguments: t.type === "tool_use" ? (t.input as Record<string, unknown>) : {},
        })),
        stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
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
