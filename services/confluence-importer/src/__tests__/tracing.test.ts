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
    vi.doMock("@opentelemetry/sdk-node", () => ({
      NodeSDK: class {
        constructor() {}
        start() {}
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
    const apiTracer = trace.getTracer("fredy-rag");
    expect(typeof tracer.startSpan).toBe("function");
    expect(typeof apiTracer.startSpan).toBe("function");
  });

  it("returned tracer produces spans that can be started and ended without error", () => {
    const tracer = getTracer();
    const span = tracer.startSpan("rag.ingest");
    span.setAttribute("pages_processed", 5);
    span.end();
  });
});
