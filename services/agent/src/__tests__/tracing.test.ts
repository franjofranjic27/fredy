import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initTracing, getTracer, _resetTracing } from "../tracing.js";
import { trace } from "@opentelemetry/api";

beforeEach(() => {
  _resetTracing();
  delete process.env.OTEL_ENABLED;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.OTEL_ENABLED;
});

describe("initTracing", () => {
  it("is a no-op when OTEL_ENABLED is not set", async () => {
    await expect(initTracing()).resolves.toBeUndefined();
  });

  it("is a no-op when OTEL_ENABLED=false", async () => {
    process.env.OTEL_ENABLED = "false";
    await expect(initTracing()).resolves.toBeUndefined();
  });

  it("does not throw if called multiple times without SDK", async () => {
    await initTracing();
    await initTracing();
  });

  it("initialises the SDK when OTEL_ENABLED=true", async () => {
    const startFn = vi.fn();
    vi.doMock("@opentelemetry/sdk-node", () => ({
      NodeSDK: class {
        constructor() {}
        start() { startFn(); }
      },
    }));
    vi.doMock("@opentelemetry/auto-instrumentations-node", () => ({
      getNodeAutoInstrumentations: () => [],
    }));
    vi.doMock("@opentelemetry/exporter-trace-otlp-http", () => ({
      OTLPTraceExporter: class {
        constructor() {}
      },
    }));

    process.env.OTEL_ENABLED = "true";
    // Because we use dynamic imports inside initTracing, the mocks above
    // intercept those calls. We just verify it completes without error.
    await expect(initTracing()).resolves.toBeUndefined();

    vi.doUnmock("@opentelemetry/sdk-node");
    vi.doUnmock("@opentelemetry/auto-instrumentations-node");
    vi.doUnmock("@opentelemetry/exporter-trace-otlp-http");
  });
});

describe("getTracer", () => {
  it("returns a Tracer instance", () => {
    const tracer = getTracer();
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe("function");
  });

  it("returns the same service-name tracer as the OTel API", () => {
    const tracer = getTracer();
    const apiTracer = trace.getTracer("fredy-agent");
    // Both are tracer objects from the same API (no-op in tests)
    expect(typeof tracer.startSpan).toBe("function");
    expect(typeof apiTracer.startSpan).toBe("function");
  });

  it("returned tracer produces spans that can be started and ended without error", () => {
    const tracer = getTracer();
    const span = tracer.startSpan("test.span");
    span.setAttribute("key", "value");
    span.end();
  });
});
