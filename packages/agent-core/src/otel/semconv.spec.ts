import { afterEach, describe, expect, it, vi } from "vitest";
import type { Span } from "@opentelemetry/api";
import {
  addLlmContentEvent,
  captureContent,
  safeStringify,
  setLlmRequestAttrs,
  setLlmResponseAttrs,
  setToolAttrs,
} from "./semconv.js";

function fakeSpan(): Span & { attributes: Record<string, unknown>; events: string[] } {
  const attributes: Record<string, unknown> = {};
  const events: string[] = [];
  return {
    attributes,
    events,
    setAttribute(key: string, value: unknown) {
      attributes[key] = value;
      return this;
    },
    addEvent(name: string) {
      events.push(name);
      return this;
    },
  } as unknown as Span & { attributes: Record<string, unknown>; events: string[] };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("captureContent", () => {
  it("is off by default", () => {
    vi.stubEnv("OTEL_GENAI_CAPTURE_CONTENT", "");
    expect(captureContent()).toBe(false);
  });

  it("is on only for the exact string true", () => {
    vi.stubEnv("OTEL_GENAI_CAPTURE_CONTENT", "true");
    expect(captureContent()).toBe(true);
    vi.stubEnv("OTEL_GENAI_CAPTURE_CONTENT", "1");
    expect(captureContent()).toBe(false);
  });
});

describe("setLlmRequestAttrs", () => {
  it("sets system, model, operation and optional sampling attributes", () => {
    const span = fakeSpan();
    setLlmRequestAttrs(span, {
      system: "anthropic",
      model: "claude-sonnet-4-5",
      maxTokens: 4096,
      temperature: 0.2,
    });
    expect(span.attributes).toEqual({
      "gen_ai.system": "anthropic",
      "gen_ai.request.model": "claude-sonnet-4-5",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.max_tokens": 4096,
      "gen_ai.request.temperature": 0.2,
    });
  });
});

describe("setLlmResponseAttrs", () => {
  it("sets only provided attributes", () => {
    const span = fakeSpan();
    setLlmResponseAttrs(span, {
      responseModel: "claude-sonnet-4-5-20250929",
      finishReasons: ["stop"],
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(span.attributes).toEqual({
      "gen_ai.response.model": "claude-sonnet-4-5-20250929",
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.usage.input_tokens": 10,
      "gen_ai.usage.output_tokens": 5,
    });
  });
});

describe("setToolAttrs", () => {
  it("omits input/output when capture is disabled", () => {
    vi.stubEnv("OTEL_GENAI_CAPTURE_CONTENT", "false");
    const span = fakeSpan();
    setToolAttrs(span, { name: "vector_search", success: true, input: { q: 1 }, output: "x" });
    expect(span.attributes["tool.input"]).toBeUndefined();
    expect(span.attributes["tool.output"]).toBeUndefined();
    expect(span.attributes["gen_ai.tool.name"]).toBe("vector_search");
    expect(span.attributes["tool.success"]).toBe(true);
  });

  it("captures input/output when enabled", () => {
    vi.stubEnv("OTEL_GENAI_CAPTURE_CONTENT", "true");
    const span = fakeSpan();
    setToolAttrs(span, { name: "vector_search", success: false, input: { q: 1 }, output: "x" });
    expect(span.attributes["tool.input"]).toBe('{"q":1}');
    expect(span.attributes["tool.output"]).toBe("x");
    expect(span.attributes["tool.success"]).toBe(false);
  });
});

describe("addLlmContentEvent", () => {
  it("adds a role-specific event only when capture is enabled", () => {
    const span = fakeSpan();
    vi.stubEnv("OTEL_GENAI_CAPTURE_CONTENT", "false");
    addLlmContentEvent(span, "user", "hello");
    expect(span.events).toEqual([]);
    vi.stubEnv("OTEL_GENAI_CAPTURE_CONTENT", "true");
    addLlmContentEvent(span, "assistant", "hi");
    expect(span.events).toEqual(["gen_ai.assistant.message"]);
  });
});

describe("safeStringify", () => {
  it("passes strings through and stringifies objects", () => {
    expect(safeStringify("s")).toBe("s");
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });

  it("falls back to String() on circular structures", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeStringify(circular)).toBe("[object Object]");
  });
});
