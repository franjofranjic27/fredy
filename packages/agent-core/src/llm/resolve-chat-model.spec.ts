import { describe, expect, it, vi } from "vitest";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { providerForModel, resolveChatModel } from "./resolve-chat-model.js";

const baseOptions = {
  fallbackModel: "claude-sonnet-4-5-20250929",
  anthropic: { apiKey: "anthropic-key", maxTokens: 2048 },
  openai: { apiKey: "openai-key", maxTokens: 1024, baseUrl: "https://proxy.example/v1" },
  gemini: { apiKey: "gemini-key", maxTokens: 512 },
};

describe("providerForModel", () => {
  it("maps prefixes to providers", () => {
    expect(providerForModel("claude-sonnet-4-5")).toBe("anthropic");
    expect(providerForModel("gpt-4o")).toBe("openai");
    expect(providerForModel("o1-mini")).toBe("openai");
    expect(providerForModel("o3")).toBe("openai");
    expect(providerForModel("o4-mini")).toBe("openai");
    expect(providerForModel("gemini-2.0-flash")).toBe("gemini");
    expect(providerForModel("mistral-large")).toBeNull();
  });
});

describe("resolveChatModel", () => {
  it("resolves claude-* to ChatAnthropic with the provider max tokens", () => {
    const model = resolveChatModel("claude-sonnet-4-5-20250929", baseOptions);
    expect(model).toBeInstanceOf(ChatAnthropic);
    expect((model as ChatAnthropic).maxTokens).toBe(2048);
  });

  it("resolves gpt-* to ChatOpenAI", () => {
    const model = resolveChatModel("gpt-4o", baseOptions);
    expect(model).toBeInstanceOf(ChatOpenAI);
    expect((model as ChatOpenAI).maxTokens).toBe(1024);
  });

  it("resolves gemini-* to ChatGoogleGenerativeAI", () => {
    const model = resolveChatModel("gemini-2.0-flash", baseOptions);
    expect(model).toBeInstanceOf(ChatGoogleGenerativeAI);
    expect((model as ChatGoogleGenerativeAI).maxOutputTokens).toBe(512);
  });

  it("defaults to the fallback model when no model id is given", () => {
    const model = resolveChatModel(undefined, baseOptions);
    expect(model).toBeInstanceOf(ChatAnthropic);
  });

  it("defaults provider max tokens to 4096", () => {
    const model = resolveChatModel("claude-sonnet-4-5", {
      fallbackModel: "claude-sonnet-4-5",
      anthropic: { apiKey: "k" },
    });
    expect((model as ChatAnthropic).maxTokens).toBe(4096);
  });

  it("prefers the per-request max tokens over provider settings", () => {
    const model = resolveChatModel("claude-sonnet-4-5", { ...baseOptions, maxTokens: 100 });
    expect((model as ChatAnthropic).maxTokens).toBe(100);
  });

  it("passes the temperature through", () => {
    const model = resolveChatModel("claude-sonnet-4-5", { ...baseOptions, temperature: 0.3 });
    expect((model as ChatAnthropic).temperature).toBe(0.3);
  });

  it("falls back to the configured model with a warning on unknown prefixes", () => {
    const warn = vi.fn();
    const model = resolveChatModel("mistral-large", { ...baseOptions, logger: { warn } });
    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(warn).toHaveBeenCalledWith(
      { model: "mistral-large", fallbackModel: baseOptions.fallbackModel },
      expect.stringContaining("falling back"),
    );
  });

  it("throws when the fallback model itself is unsupported", () => {
    expect(() => resolveChatModel("unknown-model", { fallbackModel: "unknown-model" })).toThrow(
      /configured fallback model/,
    );
  });
});
