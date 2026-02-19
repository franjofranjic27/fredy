import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "../../middleware/rate-limit.js";
import type { Context } from "hono";

function makeContext(ip = "1.2.3.4"): Context {
  const headers = new Map<string, string>([["x-forwarded-for", ip]]);
  return {
    req: {
      header: (name: string) => headers.get(name.toLowerCase()),
    },
    header: vi.fn(),
    json: vi.fn((body: unknown, status?: number) => ({ body, status })),
  } as unknown as Context;
}

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", async () => {
    const middleware = createRateLimiter({ rpm: 5, burst: 0 });
    const next = vi.fn().mockResolvedValue(undefined);
    const c = makeContext();

    for (let i = 0; i < 5; i++) {
      await middleware(c, next);
    }

    expect(next).toHaveBeenCalledTimes(5);
  });

  it("allows burst on top of rpm", async () => {
    const middleware = createRateLimiter({ rpm: 2, burst: 3 });
    const next = vi.fn().mockResolvedValue(undefined);
    const c = makeContext();

    for (let i = 0; i < 5; i++) {
      await middleware(c, next);
    }

    expect(next).toHaveBeenCalledTimes(5);
  });

  it("returns 429 when limit is exceeded", async () => {
    const middleware = createRateLimiter({ rpm: 2, burst: 0 });
    const next = vi.fn().mockResolvedValue(undefined);
    const c = makeContext();

    await middleware(c, next);
    await middleware(c, next);
    await middleware(c, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: "RATE_LIMITED" }) }),
      429,
    );
    expect(c.header).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });

  it("tracks different clients independently", async () => {
    const middleware = createRateLimiter({ rpm: 1, burst: 0 });
    const nextA = vi.fn().mockResolvedValue(undefined);
    const nextB = vi.fn().mockResolvedValue(undefined);
    const cA = makeContext("10.0.0.1");
    const cB = makeContext("10.0.0.2");

    await middleware(cA, nextA);
    await middleware(cB, nextB);

    expect(nextA).toHaveBeenCalledTimes(1);
    expect(nextB).toHaveBeenCalledTimes(1);
  });

  it("resets window after 60 seconds", async () => {
    const middleware = createRateLimiter({ rpm: 1, burst: 0 });
    const next = vi.fn().mockResolvedValue(undefined);
    const c = makeContext();

    await middleware(c, next);
    await middleware(c, next); // This should be blocked

    expect(next).toHaveBeenCalledTimes(1);

    // Advance time past the window
    vi.advanceTimersByTime(61_000);

    await middleware(c, next); // Should be allowed again

    expect(next).toHaveBeenCalledTimes(2);
  });

  it("uses custom keyFn when provided", async () => {
    const middleware = createRateLimiter({
      rpm: 1,
      burst: 0,
      keyFn: () => "custom-key",
    });
    const next = vi.fn().mockResolvedValue(undefined);
    const c1 = makeContext("1.1.1.1");
    const c2 = makeContext("2.2.2.2");

    await middleware(c1, next);
    await middleware(c2, next); // Same key → should be blocked

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("falls back to unknown when no IP header is present", async () => {
    const middleware = createRateLimiter({ rpm: 60, burst: 0 });
    const next = vi.fn().mockResolvedValue(undefined);
    const c = {
      req: { header: () => undefined },
      header: vi.fn(),
      json: vi.fn(),
    } as unknown as Context;

    await middleware(c, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
