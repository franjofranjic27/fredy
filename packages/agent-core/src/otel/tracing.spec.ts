import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetTracing, initTracing, type SdkFactory } from "./tracing.js";

/**
 * Fake SDK factory so the unit test exercises the idempotency/shutdown logic
 * without booting the real (~40 module) auto-instrumentation suite, which is
 * slow enough to time out on cold CI runners.
 */
function fakeFactory(): {
  factory: SdkFactory;
  readonly starts: number;
  readonly shutdowns: number;
} {
  const state = { starts: 0, shutdowns: 0 };
  return {
    factory: () => ({
      start: () => {
        state.starts += 1;
      },
      shutdown: async () => {
        state.shutdowns += 1;
      },
    }),
    get starts() {
      return state.starts;
    },
    get shutdowns() {
      return state.shutdowns;
    },
  };
}

describe("initTracing", () => {
  afterEach(() => {
    _resetTracing();
    vi.unstubAllEnvs();
  });

  it("returns a handle with a shutdown function and starts the SDK", async () => {
    const fake = fakeFactory();
    const handle = initTracing("test-service", fake.factory);
    expect(typeof handle.shutdown).toBe("function");
    expect(fake.starts).toBe(1);
    await handle.shutdown();
    expect(fake.shutdowns).toBe(1);
  });

  it("is idempotent — the second call reuses the active SDK", async () => {
    const fake = fakeFactory();
    initTracing("test-service", fake.factory);
    const second = initTracing("test-service", fake.factory);
    expect(typeof second.shutdown).toBe("function");
    expect(fake.starts).toBe(1); // not started twice
    await second.shutdown();
  });

  it("shutdown is safe to call twice", async () => {
    const fake = fakeFactory();
    const handle = initTracing("test-service", fake.factory);
    await handle.shutdown();
    await expect(handle.shutdown()).resolves.toBeUndefined();
    expect(fake.shutdowns).toBe(1); // second call is a no-op
  });

  it("builds an OTLP exporter when an endpoint is configured", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318/");
    let received: unknown;
    const factory: SdkFactory = (config) => {
      received = config.traceExporter;
      return { start: () => {}, shutdown: async () => {} };
    };
    initTracing("test-service", factory);
    expect(received).toBeDefined();
  });

  it("omits the exporter when no endpoint is configured", () => {
    let received: unknown = "sentinel";
    const factory: SdkFactory = (config) => {
      received = config.traceExporter;
      return { start: () => {}, shutdown: async () => {} };
    };
    initTracing("test-service", factory);
    expect(received).toBeUndefined();
  });
});
