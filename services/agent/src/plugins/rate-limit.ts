import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { AuthenticatedRequest } from "./auth.js";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export type ConsumeResult = { allowed: true } | { allowed: false; retryAfterMs: number };

export interface RateLimiterOptions {
  readonly rpm: number;
  readonly burst: number;
  /** Test seam for the clock. */
  readonly now?: () => number;
}

const EVICTION_INTERVAL_MS = 60_000;

/**
 * Per-key token bucket: capacity = burst, refilled at rpm/60000 tokens per ms.
 * Stale buckets (fully refilled since their last touch) are evicted
 * periodically so the map no longer grows unboundedly.
 */
export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private evictionTimer?: NodeJS.Timeout;

  constructor(options: RateLimiterOptions) {
    this.capacity = options.burst;
    this.refillPerMs = options.rpm / 60_000;
    this.now = options.now ?? Date.now;
  }

  consume(key: string): ConsumeResult {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefill: now };
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
      bucket.lastRefill = now;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      return { allowed: true };
    }
    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit / this.refillPerMs);
    this.buckets.set(key, bucket);
    return { allowed: false, retryAfterMs };
  }

  /** Removes buckets that have fully refilled since their last touch. */
  evictStale(now: number = this.now()): void {
    for (const [key, bucket] of this.buckets) {
      const elapsed = now - bucket.lastRefill;
      if (bucket.tokens + elapsed * this.refillPerMs >= this.capacity) {
        this.buckets.delete(key);
      }
    }
  }

  startEviction(intervalMs: number = EVICTION_INTERVAL_MS): void {
    if (this.evictionTimer) return;
    this.evictionTimer = setInterval(() => this.evictStale(), intervalMs);
    this.evictionTimer.unref();
  }

  stopEviction(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = undefined;
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * Rate-limit key: prefer the verified JWT subject — behind Open-WebUI all
 * users share one upstream IP, so IP buckets would let one user starve
 * everyone. Falls back to request.ip; with trustProxy disabled this is the
 * raw socket address, so a spoofed X-Forwarded-For cannot shift buckets; with
 * a trusted proxy allow-list Fastify derives the real client IP from XFF.
 */
export function identifyClient(request: FastifyRequest): string {
  const sub = (request as AuthenticatedRequest).user?.sub;
  if (typeof sub === "string" && sub) return `sub:${sub}`;
  return request.ip || request.socket?.remoteAddress || "unknown";
}

/** preHandler enforcing the token bucket; 429 with Retry-After on exhaustion. */
export function createRateLimitHook(limiter: TokenBucketRateLimiter): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    const result = limiter.consume(identifyClient(request));
    if (!result.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      void reply
        .code(429)
        .header("Retry-After", String(retryAfterSec))
        .send({
          error: {
            message: "Rate limit exceeded",
            code: "RATE_LIMITED",
            retry_after_ms: result.retryAfterMs,
          },
        });
    }
  };
}
