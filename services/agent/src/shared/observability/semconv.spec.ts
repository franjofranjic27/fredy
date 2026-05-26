import { Span } from "@opentelemetry/api";
import {
  GEN_AI,
  TOOL,
  addLlmContentEvent,
  captureContent,
  setLlmRequestAttrs,
  setLlmResponseAttrs,
  setToolAttrs,
} from "./semconv";

function createMockSpan(): Span & {
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attrs: unknown }>;
} {
  const attributes: Record<string, unknown> = {};
  const events: Array<{ name: string; attrs: unknown }> = [];
  return {
    attributes,
    events,
    setAttribute(key: string, value: unknown) {
      attributes[key] = value;
      return this;
    },
    setAttributes(attrs: Record<string, unknown>) {
      Object.assign(attributes, attrs);
      return this;
    },
    addEvent(name: string, attrs?: unknown) {
      events.push({ name, attrs });
      return this;
    },
    setStatus() {
      return this;
    },
    updateName() {
      return this;
    },
    end() {},
    isRecording() {
      return true;
    },
    recordException() {},
    spanContext() {
      return { traceId: "t", spanId: "s", traceFlags: 0 };
    },
  } as unknown as Span & {
    attributes: Record<string, unknown>;
    events: Array<{ name: string; attrs: unknown }>;
  };
}

describe("semconv", () => {
  const originalCapture = process.env.OTEL_GENAI_CAPTURE_CONTENT;

  afterEach(() => {
    process.env.OTEL_GENAI_CAPTURE_CONTENT = originalCapture;
  });

  describe("captureContent", () => {
    it("returns false by default", () => {
      delete process.env.OTEL_GENAI_CAPTURE_CONTENT;
      expect(captureContent()).toBe(false);
    });

    it("returns true when env flag is 'true'", () => {
      process.env.OTEL_GENAI_CAPTURE_CONTENT = "true";
      expect(captureContent()).toBe(true);
    });

    it("returns false for any value other than 'true'", () => {
      process.env.OTEL_GENAI_CAPTURE_CONTENT = "1";
      expect(captureContent()).toBe(false);
    });
  });

  describe("setLlmRequestAttrs", () => {
    it("sets system, model and operation", () => {
      const span = createMockSpan();
      setLlmRequestAttrs(span, { system: "anthropic", model: "claude-sonnet" });
      expect(span.attributes[GEN_AI.SYSTEM]).toBe("anthropic");
      expect(span.attributes[GEN_AI.REQUEST_MODEL]).toBe("claude-sonnet");
      expect(span.attributes[GEN_AI.OPERATION_NAME]).toBe("chat");
    });

    it("omits optional attributes when undefined", () => {
      const span = createMockSpan();
      setLlmRequestAttrs(span, { system: "openai", model: "gpt-4o" });
      expect(span.attributes).not.toHaveProperty(GEN_AI.REQUEST_MAX_TOKENS);
      expect(span.attributes).not.toHaveProperty(GEN_AI.REQUEST_TEMPERATURE);
    });

    it("sets optional attributes when provided", () => {
      const span = createMockSpan();
      setLlmRequestAttrs(span, {
        system: "google.gemini",
        model: "gemini-2.0",
        maxTokens: 4096,
        temperature: 0.2,
      });
      expect(span.attributes[GEN_AI.REQUEST_MAX_TOKENS]).toBe(4096);
      expect(span.attributes[GEN_AI.REQUEST_TEMPERATURE]).toBe(0.2);
    });
  });

  describe("setLlmResponseAttrs", () => {
    it("captures usage tokens and finish reason", () => {
      const span = createMockSpan();
      setLlmResponseAttrs(span, {
        responseId: "resp_1",
        responseModel: "claude-sonnet-4-5",
        finishReason: "stop",
        inputTokens: 100,
        outputTokens: 50,
      });
      expect(span.attributes[GEN_AI.RESPONSE_ID]).toBe("resp_1");
      expect(span.attributes[GEN_AI.RESPONSE_MODEL]).toBe("claude-sonnet-4-5");
      expect(span.attributes[GEN_AI.RESPONSE_FINISH_REASONS]).toEqual(["stop"]);
      expect(span.attributes[GEN_AI.USAGE_INPUT_TOKENS]).toBe(100);
      expect(span.attributes[GEN_AI.USAGE_OUTPUT_TOKENS]).toBe(50);
    });
  });

  describe("setToolAttrs", () => {
    it("sets name, operation and success flag", () => {
      const span = createMockSpan();
      setToolAttrs(span, { name: "vector_search", success: true });
      expect(span.attributes[GEN_AI.TOOL_NAME]).toBe("vector_search");
      expect(span.attributes[GEN_AI.OPERATION_NAME]).toBe("execute_tool");
      expect(span.attributes[TOOL.SUCCESS]).toBe(true);
    });

    it("does NOT include input/output when content capture is off", () => {
      delete process.env.OTEL_GENAI_CAPTURE_CONTENT;
      const span = createMockSpan();
      setToolAttrs(span, {
        name: "vector_search",
        success: true,
        input: { query: "secret" },
        output: { hits: 3 },
      });
      expect(span.attributes).not.toHaveProperty(TOOL.INPUT);
      expect(span.attributes).not.toHaveProperty(TOOL.OUTPUT);
    });

    it("includes input/output when content capture is on", () => {
      process.env.OTEL_GENAI_CAPTURE_CONTENT = "true";
      const span = createMockSpan();
      setToolAttrs(span, {
        name: "vector_search",
        success: true,
        input: { query: "ok" },
        output: { hits: 3 },
      });
      expect(span.attributes[TOOL.INPUT]).toBe('{"query":"ok"}');
      expect(span.attributes[TOOL.OUTPUT]).toBe('{"hits":3}');
    });
  });

  describe("addLlmContentEvent", () => {
    it("is a no-op when content capture is off", () => {
      delete process.env.OTEL_GENAI_CAPTURE_CONTENT;
      const span = createMockSpan();
      addLlmContentEvent(span, "user", "hello");
      expect(span.events).toHaveLength(0);
    });

    it("emits gen_ai.<role>.message event when capture is on", () => {
      process.env.OTEL_GENAI_CAPTURE_CONTENT = "true";
      const span = createMockSpan();
      addLlmContentEvent(span, "assistant", "world");
      expect(span.events).toHaveLength(1);
      expect(span.events[0].name).toBe("gen_ai.assistant.message");
      expect(span.events[0].attrs).toEqual({ content: "world" });
    });
  });
});
