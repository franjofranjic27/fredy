import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createRateLimitHook, identifyClient, TokenBucketRateLimiter } from "./rate-limit.js";
import type { FastifyRequest } from "fastify";

function limiterWithClock(rpm: number, burst: number) {
  let now = 1_000_000;
  const limiter = new TokenBucketRateLimiter({ rpm, burst, now: () => now });
  return {
    limiter,
    advance(ms: number) {
      now += ms;
    },
    current: () => now,
  };
}

describe("TokenBucketRateLimiter", () => {
  it("passes the first request through and consumes a token", () => {
    const { limiter } = limiterWithClock(60, 5);
    expect(limiter.consume("1.1.1.1")).toEqual({ allowed: true });
  });

  it("blocks the (burst+1)th request from the same key", () => {
    const { limiter } = limiterWithClock(60, 3);
    for (let i = 0; i < 3; i++) expect(limiter.consume("2.2.2.2").allowed).toBe(true);
    const blocked = limiter.consume("2.2.2.2");
    expect(blocked.allowed).toBe(false);
  });

  it("tracks keys independently", () => {
    const { limiter } = limiterWithClock(60, 1);
    expect(limiter.consume("3.3.3.3").allowed).toBe(true);
    expect(limiter.consume("4.4.4.4").allowed).toBe(true);
    expect(limiter.consume("3.3.3.3").allowed).toBe(false);
  });

  it("refills at rpm/60000 tokens per millisecond", () => {
    const { limiter, advance } = limiterWithClock(60, 1); // 1 token per second
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(false);
    advance(999);
    expect(limiter.consume("k").allowed).toBe(false);
    advance(2);
    expect(limiter.consume("k").allowed).toBe(true);
  });

  it("reports the exact retry-after deficit", () => {
    const { limiter } = limiterWithClock(60, 1); // refill 0.001 tokens/ms
    limiter.consume("k");
    const blocked = limiter.consume("k");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterMs).toBe(1000);
    }
  });

  it("caps the bucket at burst capacity", () => {
    const { limiter, advance } = limiterWithClock(6000, 2);
    limiter.consume("k");
    limiter.consume("k");
    advance(60_000); // would refill 6000 tokens without the cap
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(false);
  });

  it("evicts stale buckets once they are fully refilled", () => {
    const { limiter, advance, current } = limiterWithClock(60, 2);
    limiter.consume("a");
    limiter.consume("b");
    expect(limiter.size).toBe(2);
    limiter.evictStale(current());
    expect(limiter.size).toBe(2); // not yet refilled
    advance(2 * 60_000);
    limiter.evictStale(current());
    expect(limiter.size).toBe(0);
  });

  it("start/stopEviction manage the interval idempotently", () => {
    const limiter = new TokenBucketRateLimiter({ rpm: 60, burst: 1 });
    limiter.startEviction(10_000);
    limiter.startEviction(10_000);
    limiter.stopEviction();
    limiter.stopEviction();
  });
});

describe("identifyClient", () => {
  it("keys on request.ip and ignores a spoofed X-Forwarded-For header", () => {
    // request.ip is the raw socket address when trustProxy is off, so a client
    // cannot shift its bucket by forging X-Forwarded-For.
    const request = {
      headers: { "x-forwarded-for": "10.0.0.5, 10.0.0.1" },
      ip: "203.0.113.9",
      socket: { remoteAddress: "203.0.113.9" },
    } as unknown as FastifyRequest;
    expect(identifyClient(request)).toBe("203.0.113.9");
  });

  it("falls back to the socket address, then unknown", () => {
    expect(
      identifyClient({ headers: {}, ip: "9.9.9.9", socket: {} } as unknown as FastifyRequest),
    ).toBe("9.9.9.9");
    expect(
      identifyClient({
        headers: {},
        ip: "",
        socket: { remoteAddress: "8.8.8.8" },
      } as unknown as FastifyRequest),
    ).toBe("8.8.8.8");
    expect(identifyClient({ headers: {}, ip: "", socket: {} } as unknown as FastifyRequest)).toBe(
      "unknown",
    );
  });
});

describe("rate limit hook", () => {
  it("returns 429 with Retry-After header and the OpenAI-style error body", async () => {
    const app = Fastify();
    const limiter = new TokenBucketRateLimiter({ rpm: 60, burst: 1 });
    app.post("/x", { preHandler: [createRateLimitHook(limiter)] }, async () => ({ ok: true }));
    await app.ready();

    const first = await app.inject({ method: "POST", url: "/x", payload: {} });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: "POST", url: "/x", payload: {} });
    expect(second.statusCode).toBe(429);
    expect(Number(second.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    const body = second.json();
    expect(body.error.message).toBe("Rate limit exceeded");
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.retry_after_ms).toBeGreaterThan(0);
  });
});
