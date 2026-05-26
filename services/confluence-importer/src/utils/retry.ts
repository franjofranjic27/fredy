export interface RetryOptions {
  maxAttempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  retryable?: (error: unknown) => boolean;
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  // HTTP 429 and 5xx errors
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
  // Network-level transient errors
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/i.test(msg)) return true;
  return false;
}

/**
 * Full-jitter exponential backoff: random delay in [0, min(cap, base * 2^attempt)]
 */
function fullJitterDelay(attempt: number, minMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, minMs * Math.pow(2, attempt));
  return Math.random() * exponential;
}

/**
 * Retry an async function with full-jitter exponential backoff.
 * Defaults: 5 attempts, 1s–30s delay range.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 5,
    minDelayMs = 1000,
    maxDelayMs = 30000,
    retryable = isRetryable,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLast = attempt === maxAttempts - 1;
      if (isLast || !retryable(error)) {
        throw error;
      }

      const delay = fullJitterDelay(attempt, minDelayMs, maxDelayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
