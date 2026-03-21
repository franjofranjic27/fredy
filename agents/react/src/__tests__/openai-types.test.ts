import { describe, it, expect } from "vitest";
import {
  ChatCompletionRequestSchema,
  createCompletionResponse,
  createCompletionChunk,
} from "../openai-types.js";

describe("ChatCompletionRequestSchema", () => {
  it("accepts valid request", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "test-model",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(true);
  });

  it("defaults stream to false", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "test-model",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stream).toBe(false);
    }
  });

  it("rejects empty messages array", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "test-model",
      messages: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "test-model",
      messages: [{ role: "invalid", content: "Hello" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing model", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("createCompletionResponse", () => {
  it("creates a valid completion response", () => {
    const response = createCompletionResponse("Hello!", "test-model");
    expect(response.object).toBe("chat.completion");
    expect(response.model).toBe("test-model");
    expect(response.choices[0].message.content).toBe("Hello!");
    expect(response.choices[0].message.role).toBe("assistant");
    expect(response.choices[0].finish_reason).toBe("stop");
  });

  it("includes a unique id", () => {
    const r1 = createCompletionResponse("A", "m");
    const r2 = createCompletionResponse("B", "m");
    expect(r1.id).not.toBe(r2.id);
    expect(r1.id).toMatch(/^chatcmpl-/);
  });

  it("includes zero usage when none provided", () => {
    const response = createCompletionResponse("Hi", "model");
    expect(response.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });

  it("maps token usage to OpenAI format", () => {
    const response = createCompletionResponse("Hi", "model", { inputTokens: 100, outputTokens: 50 });
    expect(response.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
  });
});

describe("createCompletionChunk", () => {
  it("creates a chunk with content", () => {
    const chunk = createCompletionChunk("id-1", "Hello", null, "test-model");
    expect(chunk.object).toBe("chat.completion.chunk");
    expect(chunk.id).toBe("id-1");
    expect(chunk.model).toBe("test-model");
    expect(chunk.choices[0].delta).toEqual({ content: "Hello" });
    expect(chunk.choices[0].finish_reason).toBeNull();
  });

  it("creates a finish chunk with empty delta", () => {
    const chunk = createCompletionChunk("id-1", null, "stop", "test-model");
    expect(chunk.choices[0].finish_reason).toBe("stop");
    expect(chunk.choices[0].delta).toEqual({});
  });
});
