import type { MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  /** Requests per minute (default 60) */
  rpm?: number;
  /** Burst allowance on top of the window (default 10) */
  burst?: number;
  /** How to extract the client key from the request */
  keyFn?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

export function createRateLimiter(options: RateLimitOptions = {}): MiddlewareHandler {
  const { rpm = 60, burst = 10, keyFn } = options;
  const windowMs = 60_000;
  const limit = rpm + burst;

  const counters = new Map<string, WindowEntry>();

  return async (c, next) => {
    const key = keyFn ? keyFn(c) : defaultKey(c);
    const now = Date.now();

    let entry = counters.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { count: 0, windowStart: now };
    }

    entry.count += 1;
    counters.set(key, entry);

    if (entry.count > limit) {
      const retryAfter = Math.ceil((windowMs - (now - entry.windowStart)) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: { message: "Too Many Requests", code: "RATE_LIMITED" } },
        429,
      );
    }

    return next();
  };
}

function defaultKey(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}
