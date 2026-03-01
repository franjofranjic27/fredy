import { describe, it, expect, vi, beforeEach } from "vitest";
import { LlmError } from "../../llm/types.js";

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    constructor(
      public readonly status: number,
      message?: string,
    ) {
      super(message ?? String(status));
      this.name = "APIError";
    }
  }

  class MockAnthropic {
    messages = { create: mockCreate, stream: mockStream };
    static APIError = APIError;

    constructor(_options: unknown) {}
  }

  return { default: MockAnthropic };
});

import Anthropic from "@anthropic-ai/sdk";
import { createClaudeClient } from "../../llm/claude.js";

function makeMessage(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [{ type: "text", text: "Hello!" }],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  } as unknown as Anthropic.Message;
}

function makeStream(
  events: unknown[],
  finalMsg: Anthropic.Message,
): AsyncIterable<unknown> & { finalMessage: () => Promise<Anthropic.Message> } {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    finalMessage: async () => finalMsg,
  };
}

const client = createClaudeClient({ apiKey: "test-key" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createClaudeClient", () => {
  describe("non-streaming chat", () => {
    it("returns text content from a simple response", async () => {
      mockCreate.mockResolvedValueOnce(makeMessage());

      const result = await client.chat([{ role: "user", content: "Hi" }]);

      expect(result.content).toBe("Hello!");
      expect(result.toolCalls).toHaveLength(0);
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(5);
    });

    it("maps tool_use blocks to toolCalls and sets stopReason=tool_use", async () => {
      mockCreate.mockResolvedValueOnce(
        makeMessage({
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "search",
              input: { query: "hello" },
            } as Anthropic.ToolUseBlock,
          ],
          stop_reason: "tool_use",
        }),
      );

      const result = await client.chat([{ role: "user", content: "Search" }]);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.id).toBe("tool_1");
      expect(result.toolCalls[0]!.name).toBe("search");
      expect(result.toolCalls[0]!.arguments).toEqual({ query: "hello" });
      expect(result.stopReason).toBe("tool_use");
    });

    it("uses system message as system parameter", async () => {
      mockCreate.mockResolvedValueOnce(makeMessage());

      await client.chat([
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ]);

      const params = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
      expect(params.system).toBe("You are helpful.");
    });

    it("skips system messages in chat messages array", async () => {
      mockCreate.mockResolvedValueOnce(makeMessage());

      await client.chat([
        { role: "system", content: "System prompt." },
        { role: "user", content: "Hello" },
      ]);

      const params = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
      const messages = params.messages as Anthropic.MessageParam[];
      expect(messages).toHaveLength(1);
      expect(messages[0]!.role).toBe("user");
    });

    it("includes tools in the request when provided", async () => {
      mockCreate.mockResolvedValueOnce(makeMessage());

      await client.chat(
        [{ role: "user", content: "test" }],
        [{ name: "calculator", description: "calc", inputSchema: { type: "object" } }],
      );

      const params = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
      expect(params.tools).toHaveLength(1);
      expect((params.tools as { name: string }[])[0]!.name).toBe("calculator");
    });
  });

  describe("streaming chat", () => {
    it("calls onDelta for each text_delta event", async () => {
      const finalMsg = makeMessage({
        content: [{ type: "text", text: "Hello World", citations: null } as Anthropic.ContentBlock],
      });
      mockStream.mockReturnValueOnce(
        makeStream(
          [
            { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
            { type: "content_block_delta", delta: { type: "text_delta", text: " World" } },
            { type: "message_stop" },
          ],
          finalMsg,
        ),
      );

      const deltas: string[] = [];
      const result = await client.chat([{ role: "user", content: "Hi" }], undefined, (d) => {
        deltas.push(d);
      });

      expect(deltas).toEqual(["Hello", " World"]);
      expect(result.content).toBe("Hello World");
    });

    it("ignores non-text_delta events", async () => {
      const finalMsg = makeMessage();
      mockStream.mockReturnValueOnce(
        makeStream(
          [
            { type: "message_start" },
            {
              type: "content_block_delta",
              delta: { type: "input_json_delta", partial_json: "{}" },
            },
          ],
          finalMsg,
        ),
      );

      const deltas: string[] = [];
      await client.chat([{ role: "user", content: "Hi" }], undefined, (d) => {
        deltas.push(d);
      });

      expect(deltas).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("throws LlmError with RATE_LIMITED on 429", async () => {
      const error = new (
        Anthropic as unknown as { APIError: new (status: number, msg: string) => Error }
      ).APIError(429, "Too Many Requests");
      mockCreate.mockRejectedValueOnce(error);

      await expect(client.chat([{ role: "user", content: "Hi" }])).rejects.toMatchObject({
        name: "LlmError",
        code: "RATE_LIMITED",
      });
    });

    it("throws LlmError with API_ERROR on other status codes", async () => {
      const error = new (
        Anthropic as unknown as { APIError: new (status: number, msg: string) => Error }
      ).APIError(500, "Internal Server Error");
      mockCreate.mockRejectedValueOnce(error);

      await expect(client.chat([{ role: "user", content: "Hi" }])).rejects.toMatchObject({
        name: "LlmError",
        code: "API_ERROR",
      });
    });

    it("re-throws non-APIError errors as-is", async () => {
      mockCreate.mockRejectedValueOnce(new TypeError("network failure"));

      await expect(client.chat([{ role: "user", content: "Hi" }])).rejects.toBeInstanceOf(
        TypeError,
      );
      await expect(client.chat([{ role: "user", content: "Hi" }])).rejects.not.toBeInstanceOf(
        LlmError,
      );
    });
  });
});
