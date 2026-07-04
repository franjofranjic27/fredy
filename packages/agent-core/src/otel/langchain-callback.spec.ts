import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Serialized } from "@langchain/core/load/serializable";
import type { ChatGeneration } from "@langchain/core/outputs";
import { contentToString, OtelCallbackHandler } from "./langchain-callback.js";

/** Build a ChatGeneration fixture — handleLLMEnd receives chat generations at runtime. */
function chatGeneration(
  message: AIMessage,
  generationInfo?: Record<string, unknown>,
): ChatGeneration {
  return { text: contentToString(message.content), message, generationInfo };
}

const exporter = new InMemorySpanExporter();
let provider: BasicTracerProvider;

const serializedLlm = {
  lc: 1,
  type: "constructor",
  id: ["langchain", "chat_models", "ChatAnthropic"],
} as unknown as Serialized;
const serializedTool = {
  lc: 1,
  type: "not_implemented",
  id: ["vector_search"],
} as unknown as Serialized;

beforeAll(() => {
  provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
});

afterEach(() => {
  exporter.reset();
  vi.unstubAllEnvs();
});

describe("OtelCallbackHandler — chat model runs", () => {
  it("creates a gen_ai.chat span with request/response attributes from llmOutput", async () => {
    const handler = new OtelCallbackHandler();
    await handler.handleChatModelStart(
      serializedLlm,
      [[new SystemMessage("sys"), new HumanMessage("hi")]],
      "run-1",
      undefined,
      { invocation_params: { model: "claude-sonnet-4-5" } },
    );
    await handler.handleLLMEnd(
      {
        generations: [[chatGeneration(new AIMessage("hello"), { finish_reason: "stop" })]],
        llmOutput: {
          model_name: "claude-sonnet-4-5-20250929",
          tokenUsage: { promptTokens: 12, completionTokens: 3 },
        },
      },
      "run-1",
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("gen_ai.chat");
    expect(span.attributes["gen_ai.operation.name"]).toBe("chat");
    expect(span.attributes["gen_ai.request.model"]).toBe("claude-sonnet-4-5");
    expect(span.attributes["gen_ai.response.model"]).toBe("claude-sonnet-4-5-20250929");
    expect(span.attributes["gen_ai.response.finish_reasons"]).toEqual(["stop"]);
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(12);
    expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(3);
    // Content capture disabled → no message events
    expect(span.events).toHaveLength(0);
  });

  it("records request max_tokens and temperature from invocation params", async () => {
    const handler = new OtelCallbackHandler();
    await handler.handleChatModelStart(
      serializedLlm,
      [[new HumanMessage("hi")]],
      "run-req",
      undefined,
      {
        invocation_params: { model: "claude-sonnet-4-5", max_tokens: 512, temperature: 0.3 },
      },
    );
    await handler.handleLLMEnd({ generations: [[chatGeneration(new AIMessage("a"))]] }, "run-req");
    const span = exporter.getFinishedSpans()[0];
    expect(span.attributes["gen_ai.request.model"]).toBe("claude-sonnet-4-5");
    expect(span.attributes["gen_ai.request.max_tokens"]).toBe(512);
    expect(span.attributes["gen_ai.request.temperature"]).toBe(0.3);
  });

  it("ends in-flight spans as cancelled and clears state via endOpenSpans", async () => {
    const handler = new OtelCallbackHandler();
    await handler.handleChatModelStart(serializedLlm, [[new HumanMessage("q")]], "run-open");
    await handler.handleToolStart(serializedTool, "{}", "tool-open");

    handler.endOpenSpans();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      expect(span.status.code).toBe(2); // ERROR
      expect(span.status.message).toBe("cancelled");
    }
    // Maps are cleared: a late end for the same runId is a no-op.
    await handler.handleLLMEnd({ generations: [] }, "run-open");
    expect(exporter.getFinishedSpans()).toHaveLength(2);
  });

  it("endOpenSpans is idempotent and a no-op with no open spans", () => {
    const handler = new OtelCallbackHandler();
    handler.endOpenSpans();
    handler.endOpenSpans();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("extracts anthropic-style usage from llmOutput.usage", async () => {
    const handler = new OtelCallbackHandler();
    await handler.handleChatModelStart(serializedLlm, [[new HumanMessage("q")]], "run-2");
    await handler.handleLLMEnd(
      {
        generations: [[chatGeneration(new AIMessage("a"))]],
        llmOutput: { usage: { input_tokens: 7, output_tokens: 2 } },
      },
      "run-2",
    );
    const span = exporter.getFinishedSpans()[0];
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(7);
    expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(2);
  });

  it("falls back to usage_metadata on the message", async () => {
    const handler = new OtelCallbackHandler();
    await handler.handleChatModelStart(serializedLlm, [[new HumanMessage("q")]], "run-3");
    const message = new AIMessage({
      content: "a",
      usage_metadata: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
    });
    await handler.handleLLMEnd({ generations: [[chatGeneration(message)]] }, "run-3");
    const span = exporter.getFinishedSpans()[0];
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(5);
    expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(1);
  });

  it("records message content as span events only when capture is enabled", async () => {
    vi.stubEnv("OTEL_GENAI_CAPTURE_CONTENT", "true");
    const handler = new OtelCallbackHandler();
    await handler.handleChatModelStart(
      serializedLlm,
      [[new SystemMessage("sys"), new HumanMessage("hi")]],
      "run-4",
    );
    await handler.handleLLMEnd(
      { generations: [[chatGeneration(new AIMessage("hello"))]] },
      "run-4",
    );
    const span = exporter.getFinishedSpans()[0];
    expect(span.events.map((event) => event.name)).toEqual([
      "gen_ai.system.message",
      "gen_ai.user.message",
      "gen_ai.assistant.message",
    ]);
  });

  it("ends the span with error status on LLM failure", async () => {
    const handler = new OtelCallbackHandler();
    await handler.handleChatModelStart(serializedLlm, [[new HumanMessage("q")]], "run-5");
    await handler.handleLLMError(new Error("boom"), "run-5");
    const span = exporter.getFinishedSpans()[0];
    expect(span.status.code).toBe(2); // ERROR
    expect(span.status.message).toBe("boom");
  });

  it("ignores end/error events for unknown run ids", async () => {
    const handler = new OtelCallbackHandler();
    await handler.handleLLMEnd({ generations: [] }, "unknown");
    await handler.handleLLMError(new Error("x"), "unknown");
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});

describe("OtelCallbackHandler — tool runs", () => {
  it("creates a gen_ai.tool.execute span with success=true", async () => {
    const handler = new OtelCallbackHandler();
    await handler.handleToolStart(serializedTool, '{"query":"vpn"}', "tool-1");
    await handler.handleToolEnd("result text", "tool-1");
    const span = exporter.getFinishedSpans()[0];
    expect(span.name).toBe("gen_ai.tool.execute");
    expect(span.attributes["gen_ai.tool.name"]).toBe("vector_search");
    expect(span.attributes["gen_ai.operation.name"]).toBe("execute_tool");
    expect(span.attributes["tool.success"]).toBe(true);
    expect(span.attributes["tool.input"]).toBeUndefined();
    expect(span.attributes["tool.output"]).toBeUndefined();
  });

  it("captures tool input/output when the content gate is open", async () => {
    vi.stubEnv("OTEL_GENAI_CAPTURE_CONTENT", "true");
    const handler = new OtelCallbackHandler();
    await handler.handleToolStart(serializedTool, '{"query":"vpn"}', "tool-2");
    await handler.handleToolEnd("result text", "tool-2");
    const span = exporter.getFinishedSpans()[0];
    expect(span.attributes["tool.input"]).toBe('{"query":"vpn"}');
    expect(span.attributes["tool.output"]).toBe("result text");
  });

  it("marks tool failures with success=false and error status", async () => {
    const handler = new OtelCallbackHandler();
    await handler.handleToolStart(serializedTool, "{}", "tool-3");
    await handler.handleToolError(new Error("db down"), "tool-3");
    const span = exporter.getFinishedSpans()[0];
    expect(span.attributes["tool.success"]).toBe(false);
    expect(span.status.code).toBe(2);
  });
});

describe("contentToString", () => {
  it("handles strings, text blocks and unknown shapes", () => {
    expect(contentToString("plain")).toBe("plain");
    expect(contentToString([{ type: "text", text: "a" }, { type: "image" }, "b"])).toBe("ab");
    expect(contentToString(42)).toBe("");
  });
});
