import { describe, expect, it } from "vitest";
import {
  ChatCompletionRequestSchema,
  createCompletionChunk,
  createCompletionResponse,
} from "./types.js";

describe("ChatCompletionRequestSchema", () => {
  it("accepts a minimal valid request and defaults stream to false", () => {
    const parsed = ChatCompletionRequestSchema.parse({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(parsed.stream).toBe(false);
    expect(parsed.model).toBeUndefined();
  });

  it("accepts sampling parameters", () => {
    const parsed = ChatCompletionRequestSchema.parse({
      model: "rag-agent",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.5,
      max_tokens: 128,
      top_p: 0.9,
      stream: true,
    });
    expect(parsed.temperature).toBe(0.5);
    expect(parsed.max_tokens).toBe(128);
    expect(parsed.stream).toBe(true);
  });

  it("rejects empty message lists and unknown roles", () => {
    expect(ChatCompletionRequestSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(
      ChatCompletionRequestSchema.safeParse({ messages: [{ role: "tool", content: "x" }] }).success,
    ).toBe(false);
  });
});

describe("createCompletionResponse", () => {
  it("builds the OpenAI chat.completion shape", () => {
    const response = createCompletionResponse("answer", "rag-agent", undefined, "chatcmpl-1");
    expect(response).toMatchObject({
      id: "chatcmpl-1",
      object: "chat.completion",
      model: "rag-agent",
      choices: [
        { index: 0, message: { role: "assistant", content: "answer" }, finish_reason: "stop" },
      ],
    });
    expect(response.usage).toBeUndefined();
    expect(typeof response.created).toBe("number");
  });

  it("maps usage to prompt/completion/total tokens", () => {
    const response = createCompletionResponse("a", "rag-agent", {
      inputTokens: 120,
      outputTokens: 22,
    });
    expect(response.usage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 22,
      total_tokens: 142,
    });
  });
});

describe("createCompletionChunk", () => {
  it("builds a role-bearing first delta", () => {
    const chunk = createCompletionChunk(
      "id-1",
      { role: "assistant", content: "" },
      null,
      "rag-agent",
    );
    expect(chunk.object).toBe("chat.completion.chunk");
    expect(chunk.choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(chunk.choices[0].finish_reason).toBeNull();
  });

  it("builds content deltas", () => {
    const chunk = createCompletionChunk("id-1", { content: "hello" }, null, "rag-agent");
    expect(chunk.choices[0].delta).toEqual({ content: "hello" });
  });

  it("builds the terminal chunk with an empty delta and stop reason", () => {
    const chunk = createCompletionChunk("id-1", {}, "stop", "rag-agent");
    expect(chunk.choices[0].delta).toEqual({});
    expect(chunk.choices[0].finish_reason).toBe("stop");
  });
});
