# Todo 3: Retry & Resilience

**Goal:** Wrap all external HTTP calls (Confluence, OpenAI, Qdrant) in exponential backoff
with jitter. Add overlap protection to the cron scheduler.

This is the highest-priority fix — it directly causes the sparse-DB problem.

---

## New File: `src/utils/retry.ts`

```typescript
export interface RetryOptions {
  maxAttempts: number;       // recommended: 5
  baseDelayMs: number;       // recommended: 1000
  maxDelayMs: number;        // recommended: 30_000
  retryableStatusCodes: number[]; // [429, 500, 502, 503, 504]
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

// Thrown by callers to signal a retryable HTTP failure.
// Normal Error subclasses are NOT retried (fast-fail for programming errors).
export class RetryableError extends Error {
  constructor(public statusCode: number, message: string) { ... }
}

// Full-jitter backoff: delay = random(0, min(maxDelay, base * 2^attempt))
// Reads Retry-After header when statusCode === 429.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<T>
```

**Backoff strategy:** Full-jitter — spreads load when many workers retry simultaneously.
Formula: `delay = Math.random() * Math.min(maxDelay, baseDelay * 2 ** attempt)`

**`Retry-After` header:** When the caught error is a `RetryableError` with status 429
and the original response had a `Retry-After` header, use that value as the delay
instead of computing one.

---

## Files to Change

### `src/confluence/client.ts`

Wrap the private `fetch<T>()` method:

```typescript
private async fetch<T>(endpoint: string): Promise<T> {
  return withRetry(async () => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      if (RETRYABLE_STATUS_CODES.includes(response.status)) {
        throw new RetryableError(response.status, await response.text());
      }
      throw new Error(`Confluence API error (${response.status}): ...`);
    }
    return response.json();
  });
}
```

### `src/embeddings/openai.ts`

Wrap `embed()` and add sub-batching (OpenAI limit: 2048 inputs per request):

```typescript
async embed(texts: string[]): Promise<number[][]> {
  // Sub-batch into chunks of ≤2048 to stay within API limits
  const SUB_BATCH_SIZE = 2048;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += SUB_BATCH_SIZE) {
    const sub = texts.slice(i, i + SUB_BATCH_SIZE);
    const embeddings = await withRetry(() => this.fetchEmbeddings(sub));
    results.push(...embeddings);
  }
  return results;
}
```

### `src/embeddings/voyage.ts`

Same pattern as OpenAI — wrap `embed()` with `withRetry()`.

### `src/scheduler/cron.ts`

Add overlap protection:

```typescript
let syncInProgress = false;

cron.schedule(config.cronSchedule, async () => {
  if (syncInProgress) {
    logger.warn("sync already in progress, skipping tick");
    return;
  }
  syncInProgress = true;
  try {
    await syncConfluence(...);
  } finally {
    syncInProgress = false;
  }
});
```

---

## Retry Defaults by Service

| Service | Max attempts | Why |
|---------|-------------|-----|
| Confluence API | 5 | Occasional 503 during large space crawls |
| OpenAI Embeddings | 5 | 429 rate limits are the main failure mode |
| Voyage Embeddings | 5 | Same as OpenAI |
| Qdrant upsert | 3 | Usually fast; network blips only |

---

## Verification

1. **Unit test** (see [Todo 4](04-tests-vitest.md)): mock throws `RetryableError` twice then
   resolves — verify the function was called 3 times.
2. **Manual**: set `EMBEDDING_API_KEY` to a wrong value, run `ingest`, observe retry logs
   (5 attempts, exponential delays, then hard failure with clear error message).