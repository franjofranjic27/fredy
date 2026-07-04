import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export const DEFAULT_MAX_TOKENS = 4096;

export type LlmProvider = "anthropic" | "openai" | "gemini";

export interface ProviderSettings {
  readonly apiKey?: string;
  /** Provider-specific max output tokens (e.g. ANTHROPIC_MAX_TOKENS); defaults to 4096. */
  readonly maxTokens?: number;
}

export interface OpenAiProviderSettings extends ProviderSettings {
  readonly baseUrl?: string;
}

export interface ResolveChatModelOptions {
  /** Model used when the requested model id has no known provider prefix. */
  readonly fallbackModel: string;
  readonly anthropic?: ProviderSettings;
  readonly openai?: OpenAiProviderSettings;
  readonly gemini?: ProviderSettings;
  /** Per-request sampling temperature passthrough. */
  readonly temperature?: number;
  /** Per-request max output tokens; overrides the provider default. */
  readonly maxTokens?: number;
  readonly logger?: { warn(obj: unknown, msg?: string): void };
}

export function providerForModel(modelId: string): LlmProvider | null {
  if (modelId.startsWith("claude-")) return "anthropic";
  if (
    modelId.startsWith("gpt-") ||
    modelId.startsWith("o1") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4")
  ) {
    return "openai";
  }
  if (modelId.startsWith("gemini-")) return "gemini";
  return null;
}

/**
 * Maps a model id onto a LangChain ChatModel: claude-* → Anthropic,
 * gpt-* and o1/o3/o4* → OpenAI, gemini-* → Google GenAI. Unknown prefixes
 * fall back to the configured fallback model (with a warning).
 */
export function resolveChatModel(
  modelId: string | undefined,
  options: ResolveChatModelOptions,
): BaseChatModel {
  const requested = modelId ?? options.fallbackModel;
  const provider = providerForModel(requested);

  if (!provider) {
    if (requested === options.fallbackModel) {
      throw new Error(
        `No LLM provider supports model "${requested}" and it is the configured fallback model`,
      );
    }
    options.logger?.warn(
      { model: requested, fallbackModel: options.fallbackModel },
      `No LLM provider supports model "${requested}" — falling back to "${options.fallbackModel}"`,
    );
    return resolveChatModel(options.fallbackModel, options);
  }

  switch (provider) {
    case "anthropic":
      return new ChatAnthropic({
        model: requested,
        apiKey: options.anthropic?.apiKey,
        maxTokens: options.maxTokens ?? options.anthropic?.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      });
    case "openai":
      return new ChatOpenAI({
        model: requested,
        apiKey: options.openai?.apiKey,
        maxTokens: options.maxTokens ?? options.openai?.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.openai?.baseUrl ? { configuration: { baseURL: options.openai.baseUrl } } : {}),
      });
    case "gemini":
      return new ChatGoogleGenerativeAI({
        model: requested,
        apiKey: options.gemini?.apiKey,
        maxOutputTokens: options.maxTokens ?? options.gemini?.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      });
  }
}
