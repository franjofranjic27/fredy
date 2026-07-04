import type { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { AIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { AgentUsage } from "@fredy/agent-core";

export interface CreateModelOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export type CreateModelFactory = (options?: CreateModelOptions) => BaseChatModel;

/**
 * Seam for structured LLM calls so node tests can inject plain fakes instead
 * of wiring withStructuredOutput through a chat-model stub.
 */
export type InvokeStructured = <T>(
  schema: z.ZodType<T>,
  messages: BaseMessage[],
  config?: RunnableConfig,
) => Promise<T>;

export function defaultInvokeStructured(createModel: CreateModelFactory): InvokeStructured {
  return async <T>(
    schema: z.ZodType<T>,
    messages: BaseMessage[],
    config?: RunnableConfig,
  ): Promise<T> => {
    const model = createModel({ temperature: 0 });
    const structured = model.withStructuredOutput(schema);
    // withStructuredOutput widens to Record<string, any>; the zod schema
    // already validated the shape at the tool-call layer.
    return (await structured.invoke(messages, config)) as T;
  };
}

export function extractUsage(message: AIMessage): AgentUsage | undefined {
  const usage = message.usage_metadata;
  if (!usage) return undefined;
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
}

export function extractResponseModel(message: AIMessage): string | undefined {
  const metadata = message.response_metadata as Record<string, unknown> | undefined;
  const model = metadata?.model ?? metadata?.model_name;
  return typeof model === "string" ? model : undefined;
}

export function addUsage(
  current: AgentUsage | undefined,
  next: AgentUsage | undefined,
): AgentUsage | undefined {
  if (!next) return current;
  if (!current) return next;
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
  };
}
