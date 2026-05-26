import {
  ChatCompletionRequestSchema,
  createCompletionChunk,
  createCompletionResponse,
} from "./openai-types";

describe("openai-types", () => {
  describe("ChatCompletionRequestSchema", () => {
    it("accepts a minimal valid payload", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: "user", content: "hi" }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty message arrays", () => {
      const result = ChatCompletionRequestSchema.safeParse({ messages: [] });
      expect(result.success).toBe(false);
    });

    it("defaults stream to false", () => {
      const parsed = ChatCompletionRequestSchema.parse({
        messages: [{ role: "user", content: "hi" }],
      });
      expect(parsed.stream).toBe(false);
    });

    it("rejects unknown roles", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: "tool", content: "x" }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createCompletionResponse", () => {
    it("wraps content into OpenAI-compatible shape", () => {
      const resp = createCompletionResponse("hi there", "fredy-it-agent", {
        inputTokens: 10,
        outputTokens: 5,
      });
      expect(resp).toMatchObject({
        object: "chat.completion",
        model: "fredy-it-agent",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hi there" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    });

    it("omits usage when not provided", () => {
      const resp = createCompletionResponse("hi", "m");
      expect(resp.usage).toBeUndefined();
    });
  });

  describe("createCompletionChunk", () => {
    it("emits delta content when string provided", () => {
      const chunk = createCompletionChunk("id1", "tok", null, "m");
      expect(chunk.choices[0].delta).toEqual({ content: "tok" });
      expect(chunk.choices[0].finish_reason).toBeNull();
    });

    it("emits empty delta when content is null", () => {
      const chunk = createCompletionChunk("id1", null, "stop", "m");
      expect(chunk.choices[0].delta).toEqual({});
      expect(chunk.choices[0].finish_reason).toBe("stop");
    });
  });
});
