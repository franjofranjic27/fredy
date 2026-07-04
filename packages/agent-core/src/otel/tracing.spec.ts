import { afterEach, describe, expect, it } from "vitest";
import { _resetTracing, initTracing } from "./tracing.js";

describe("initTracing", () => {
  afterEach(() => {
    _resetTracing();
  });

  it("returns a handle with a shutdown function", async () => {
    const handle = initTracing("test-service");
    expect(typeof handle.shutdown).toBe("function");
    await handle.shutdown();
  });

  it("is idempotent — the second call reuses the active SDK", async () => {
    const first = initTracing("test-service");
    const second = initTracing("test-service");
    expect(typeof second.shutdown).toBe("function");
    await first.shutdown();
  });

  it("shutdown is safe to call twice", async () => {
    const handle = initTracing("test-service");
    await handle.shutdown();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
