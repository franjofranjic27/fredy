import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient, Message, ToolResult, TokenUsage } from "./llm/types.js";
import type { ToolRegistry } from "./tools/registry.js";

export type AgentErrorCode =
  | "RATE_LIMITED"
  | "API_ERROR"
  | "MAX_ITERATIONS"
  | "TOOL_ERROR"
  | "UNKNOWN";

export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export interface AgentConfig {
  llm: LLMClient;
  tools: ToolRegistry;
  systemPrompt: string;
  maxIterations?: number;
  verbose?: boolean;
}

export interface AgentResult {
  response: string;
  toolsUsed: Array<{ name: string; input: unknown; output: unknown }>;
  iterations: number;
  usage: TokenUsage;
}

export async function runAgent(
  config: AgentConfig,
  inputMessages: Message[],
  previousMessages: Message[] = []
): Promise<AgentResult> {
  const { llm, tools, systemPrompt, maxIterations = 10, verbose = false } = config;
  const toolsUsed: AgentResult["toolsUsed"] = [];
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...previousMessages.filter((m) => m.role !== "system"),
    ...inputMessages.filter((m) => m.role !== "system"),
  ];

  const log = verbose ? console.log : () => {};

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    log(`\n--- Iteration ${iteration + 1} ---`);

    let response;
    try {
      response = await llm.chat(messages, tools.toDefinitions());
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        if (error.status === 429) {
          throw new AgentError("RATE_LIMITED", "Rate limit exceeded", error);
        }
        if (error.status >= 500) {
          throw new AgentError("API_ERROR", `Anthropic API error: ${error.status}`, error);
        }
      }
      throw new AgentError("UNKNOWN", String(error), error);
    }

    if (response.usage) {
      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;
    }

    log(`Stop reason: ${response.stopReason}`);
    if (response.content) {
      log(`Content: ${response.content.slice(0, 100)}...`);
    }

    // If no tool calls, return the final response
    if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
      return {
        response: response.content ?? "",
        toolsUsed,
        iterations: iteration + 1,
        usage: totalUsage,
      };
    }

    // Add assistant message with tool calls
    if (response.content) {
      messages.push({ role: "assistant", content: response.content });
    }

    // Process all tool calls in parallel
    const results = await Promise.all(
      response.toolCalls.map(async (toolCall) => {
        log(`Tool call: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`);

        let result: unknown;
        let isError = false;

        try {
          result = await tools.execute(toolCall.name, toolCall.arguments);
          log(`Tool result: ${JSON.stringify(result).slice(0, 200)}`);
        } catch (error) {
          isError = true;
          result = { error: error instanceof Error ? error.message : String(error) };
          log(`Tool error: ${JSON.stringify(result)}`);
        }

        return {
          toolUsed: { name: toolCall.name, input: toolCall.arguments, output: result },
          toolResult: {
            toolCallId: toolCall.id,
            content: JSON.stringify(result),
            isError,
          } satisfies ToolResult,
        };
      })
    );

    const toolResults: ToolResult[] = [];
    for (const { toolUsed, toolResult } of results) {
      toolsUsed.push(toolUsed);
      toolResults.push(toolResult);
    }

    // Add tool results as a user message for the next iteration
    messages.push({
      role: "user",
      content: results
        .map(({ toolUsed, toolResult }) => `Tool "${toolUsed.name}" returned: ${toolResult.content}`)
        .join("\n\n"),
    });
  }

  throw new AgentError("MAX_ITERATIONS", `Agent exceeded max iterations (${maxIterations})`);
}
