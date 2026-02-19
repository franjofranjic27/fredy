import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOllamaClient } from "../../llm/ollama.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeNdjsonStream(lines: object[]): Response {
  const text = lines.map((l) => JSON.stringify(l)).join("\n");
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createOllamaClient", () => {
  describe("non-streaming chat", () => {
    it("returns content from a simple response", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({
          message: { role: "assistant", content: "Hello!" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 10,
          eval_count: 5,
        })
      );

      const client = createOllamaClient({ baseUrl: "http://localhost:11434", model: "llama3.2" });
      const result = await client.chat([{ role: "user", content: "Hi" }]);

      expect(result.content).toBe("Hello!");
      expect(result.toolCalls).toHaveLength(0);
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(5);
    });

    it("maps tool_calls in response to stopReason=tool_use", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
                  name: "calculator",
                  arguments: { expression: "1+1" },
                },
              },
            ],
          },
          done: true,
          done_reason: "tool_calls",
        })
      );

      const client = createOllamaClient({});
      const result = await client.chat([{ role: "user", content: "Calculate 1+1" }]);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.name).toBe("calculator");
      expect(result.toolCalls[0]!.arguments).toEqual({ expression: "1+1" });
      expect(result.stopReason).toBe("tool_use");
    });

    it("parses tool arguments when they arrive as a JSON string", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
                  name: "search",
                  arguments: JSON.stringify({ query: "hello" }),
                },
              },
            ],
          },
          done: true,
        })
      );

      const client = createOllamaClient({});
      const result = await client.chat([{ role: "user", content: "Search" }]);

      expect(result.toolCalls[0]!.arguments).toEqual({ query: "hello" });
    });

    it("throws on HTTP errors", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response("model not found", { status: 404 })
      );

      const client = createOllamaClient({});
      await expect(client.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
        "Ollama request failed (404)"
      );
    });

    it("sends tools in the request body when provided", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({
          message: { role: "assistant", content: "ok" },
          done: true,
        })
      );

      const client = createOllamaClient({});
      await client.chat(
        [{ role: "user", content: "test" }],
        [{ name: "myTool", description: "does stuff", inputSchema: { type: "object" } }],
      );

      const [, init] = vi.mocked(fetch).mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body).toHaveProperty("tools");
    });

    it("uses defaults when options are omitted", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({ message: { role: "assistant", content: "hi" }, done: true })
      );

      const client = createOllamaClient({});
      const [url, init] = await (async () => {
        await client.chat([{ role: "user", content: "test" }]);
        return vi.mocked(fetch).mock.calls[0]!;
      })();

      expect(url).toBe("http://localhost:11434/api/chat");
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body.model).toBe("llama3.2");
    });
  });

  describe("streaming chat", () => {
    it("calls onDelta for each token and returns aggregated content", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeNdjsonStream([
          { message: { role: "assistant", content: "Hel" }, done: false },
          { message: { role: "assistant", content: "lo!" }, done: false },
          { message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 3 },
        ])
      );

      const client = createOllamaClient({});
      const deltas: string[] = [];
      const result = await client.chat(
        [{ role: "user", content: "Hi" }],
        undefined,
        (d) => { deltas.push(d); },
      );

      expect(deltas).toEqual(["Hel", "lo!"]);
      expect(result.content).toBe("Hello!");
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage?.inputTokens).toBe(5);
      expect(result.usage?.outputTokens).toBe(3);
    });

    it("collects tool_calls from streaming chunks", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeNdjsonStream([
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ function: { name: "search", arguments: { q: "foo" } } }],
            },
            done: false,
          },
          { message: { role: "assistant", content: "" }, done: true, done_reason: "tool_calls" },
        ])
      );

      const client = createOllamaClient({});
      const result = await client.chat(
        [{ role: "user", content: "Search foo" }],
        undefined,
        () => {},
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.name).toBe("search");
      expect(result.stopReason).toBe("tool_use");
    });

    it("throws when response body is null", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, { status: 200 })
      );

      const client = createOllamaClient({});
      await expect(
        client.chat([{ role: "user", content: "Hi" }], undefined, () => {})
      ).rejects.toThrow("no body");
    });
  });
});
