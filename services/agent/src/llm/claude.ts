import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMClient,
  Message,
  ToolDefinition,
  ToolResult,
  LLMResponse,
} from "./types.js";

export interface ClaudeClientOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export function createClaudeClient(options: ClaudeClientOptions): LLMClient {
  const {
    apiKey,
    model = "claude-sonnet-4-20250514",
    maxTokens = 4096,
  } = options;

  const client = new Anthropic({ apiKey });

  return {
    async chat(
      messages: Message[],
      tools?: ToolDefinition[],
      toolResults?: ToolResult[]
    ): Promise<LLMResponse> {
      const systemMessage = messages.find((m) => m.role === "system");
      const chatMessages = buildMessages(messages, toolResults);

      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemMessage?.content,
        messages: chatMessages,
        tools: tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
        })),
      });

      const textContent = response.content.find((c) => c.type === "text");
      const toolUseBlocks = response.content.filter(
        (c) => c.type === "tool_use"
      );

      return {
        content: textContent?.type === "text" ? textContent.text : null,
        toolCalls: toolUseBlocks.map((t) => ({
          id: t.type === "tool_use" ? t.id : "",
          name: t.type === "tool_use" ? t.name : "",
          arguments:
            t.type === "tool_use" ? (t.input as Record<string, unknown>) : {},
        })),
        stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
      };
    },
  };
}

function buildMessages(
  messages: Message[],
  toolResults?: ToolResult[]
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    result.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }

  // Append tool results if provided
  if (toolResults && toolResults.length > 0) {
    result.push({
      role: "user",
      content: toolResults.map((tr) => ({
        type: "tool_result" as const,
        tool_use_id: tr.toolCallId,
        content: tr.content,
        is_error: tr.isError,
      })),
    });
  }

  return result;
}
