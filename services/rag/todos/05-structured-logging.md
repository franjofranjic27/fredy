# Todo 5: Structured Logging

**Goal:** Replace all `console.log` / `console.error` calls with a leveled, structured
logger — identical pattern to `services/agent/src/logger.ts`.

---

## New File: `src/logger.ts`

Copy directly from `services/agent/src/logger.ts`. The implementation is dependency-free
(no pino, no winston) and works with the project's ESM setup.

**Interface:**

```typescript
type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(level?: Level): Logger;
export const noopLogger: Logger; // all methods are no-ops
```

**Output format:**
- `NODE_ENV=production` → JSON lines: `{"level":"info","msg":"...","ts":...,"meta":{...}}`
- Development → human-readable: `[INFO]  processing space  { spaceKey: "IT" }`

---

## Files to Change

### `src/config.ts`

Add `LOG_LEVEL` to the Zod schema:

```typescript
logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
```

Env var: `LOG_LEVEL` (default `info`).

### `src/pipeline/ingest.ts`, `sync.ts`, `ingest-local.ts`

Replace `verbose?: boolean` parameter with `logger?: Logger`:

```typescript
// Before
export interface IngestOptions {
  ...
  verbose?: boolean;
}
const log = verbose ? console.log : () => {};

// After
export interface IngestOptions {
  ...
  logger?: Logger;
}
const log = logger ?? noopLogger;
```

### `src/index.ts`

Create one logger per process and pass it to all pipeline calls:

```typescript
const logger = createLogger(config.logLevel);
// then pass logger to ingestConfluenceToQdrant, syncConfluence, etc.
```

### `src/scheduler/cron.ts`

Accept a `logger` parameter and use it for cron tick logs.

---

## Key Log Points

| Location | Level | Message | Meta |
|----------|-------|---------|------|
| `ingest.ts` — space loop | `info` | `"processing space"` | `{ spaceKey }` |
| `ingest.ts` — label skip | `debug` | `"skipping page"` | `{ pageId, title, labels }` |
| `ingest.ts` — embed batch | `debug` | `"embedding chunks"` | `{ count, spaceKey }` |
| `ingest.ts` — upsert done | `info` | `"stored chunks"` | `{ count, spaceKey }` |
| `ingest.ts` — page error | `error` | `"page failed"` | `{ pageId, error }` |
| `cron.ts` — tick start | `info` | `"sync started"` | `{ schedule }` |
| `cron.ts` — tick done | `info` | `"sync complete"` | `{ pagesUpdated, chunksCreated }` |
| `cron.ts` — overlap skip | `warn` | `"sync skipped, already running"` | — |

---

## Verification

```bash
# Debug output for diagnose command
LOG_LEVEL=debug node dist/index.js diagnose

# JSON lines in production mode
NODE_ENV=production node dist/index.js sync
# → {"level":"info","msg":"processing space","ts":...,"spaceKey":"IT"}
```