import type { LLMClient, Message, ToolResult } from "./llm/types.js";
import type { ToolRegistry } from "./tools/registry.js";

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
}

export async function runAgent(
  config: AgentConfig,
  userMessage: string
): Promise<AgentResult> {
  const { llm, tools, systemPrompt, maxIterations = 10, verbose = false } = config;
  const toolsUsed: AgentResult["toolsUsed"] = [];

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const log = verbose ? console.log : () => {};

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    log(`\n--- Iteration ${iteration + 1} ---`);

    const response = await llm.chat(messages, tools.toDefinitions());

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
      };
    }

    // Add assistant message with tool calls
    if (response.content) {
      messages.push({ role: "assistant", content: response.content });
    }

    // Process each tool call
    const toolResults: ToolResult[] = [];

    for (const toolCall of response.toolCalls) {
      log(`Tool call: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`);

      let result: unknown;
      let isError = false;

      try {
        result = await tools.execute(toolCall.name, toolCall.arguments);
        log(`Tool result: ${JSON.stringify(result).slice(0, 200)}`);
      } catch (error) {
        isError = true;
        result = {
          error: error instanceof Error ? error.message : String(error),
        };
        log(`Tool error: ${JSON.stringify(result)}`);
      }

      toolsUsed.push({
        name: toolCall.name,
        input: toolCall.arguments,
        output: result,
      });

      toolResults.push({
        toolCallId: toolCall.id,
        content: JSON.stringify(result),
        isError,
      });
    }

    // Add tool results as a user message for the next iteration
    messages.push({
      role: "user",
      content: toolResults
        .map(
          (tr) =>
            `Tool "${toolsUsed[toolsUsed.length - toolResults.length + toolResults.indexOf(tr)]?.name}" returned: ${tr.content}`
        )
        .join("\n\n"),
    });
  }

  throw new Error(`Agent exceeded max iterations (${maxIterations})`);
}
