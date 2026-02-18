# Todo 4: Tests with Vitest

**Goal:** Introduce a test framework. Focus on the two purest functions (no HTTP, no DB):
`chunkHtmlContent` and `withRetry` (after Todo 3). Add label-filter unit tests for
`ConfluenceClient.shouldIncludePage`.

**Depends on:** [Todo 3](03-retry-resilience.md) — the retry utility must exist before
`retry.test.ts` can be written.

---

## Files to Add / Change

| File | Action |
|------|--------|
| `package.json` | Add `vitest` devDependency + `test` / `test:run` scripts |
| `vitest.config.ts` | New file — minimal config |
| `src/__tests__/chunking/html-chunker.test.ts` | New file |
| `src/__tests__/utils/retry.test.ts` | New file (after Todo 3) |
| `src/__tests__/confluence/client.test.ts` | New file |

---

## `package.json` Changes

```json
{
  "devDependencies": {
    "vitest": "^2.0.0"
  },
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

## `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
```

Mirrors the pattern used in `services/agent/`.

---

## Test Cases: `html-chunker.test.ts`

| # | Description |
|---|-------------|
| 1 | Empty HTML string → returns `[]` |
| 2 | Single short paragraph → 1 chunk containing the `Page:` prefix |
| 3 | Context prefix contains page title and ancestor path |
| 4 | Two `<h1>` sections → 2 chunks with different `headerPath` |
| 5 | Section larger than 800 tokens (use `"word ".repeat(1600)`) → multiple chunks |
| 6 | `<table>` element → chunk has `contentType === "table"` |
| 7 | `<pre><code>` block → chunk has `contentType === "code"` |
| 8 | All chunk IDs are unique within one page |
| 9 | `chunkIndex` runs 0..N-1; `totalChunks` is consistent across all chunks |

---

## Test Cases: `retry.test.ts`

| # | Description |
|---|-------------|
| 1 | Function succeeds on first attempt → called exactly once |
| 2 | Throws `RetryableError` twice then succeeds → called 3 times |
| 3 | Always throws `RetryableError` → rejects after `maxAttempts` |
| 4 | Throws a plain `Error` (not `RetryableError`) → rejects immediately, no retry |
| 5 | Delays grow exponentially (`vi.useFakeTimers()` to control time) |

---

## Test Cases: `client.test.ts`

Tests `ConfluenceClient.shouldIncludePage` — pure logic, no HTTP needed.

| # | Input | Expected |
|---|-------|----------|
| 1 | No filters configured | `true` |
| 2 | Page has an excluded label | `false` |
| 3 | Include filter set, page has none of them | `false` |
| 4 | Include filter set, page has one of them | `true` |
| 5 | Page has both an included and an excluded label | `false` (exclude wins) |

---

## Verification

```bash
cd services/rag
pnpm test:run
```

All tests green. No mocks of external services needed — all tested functions are pure.