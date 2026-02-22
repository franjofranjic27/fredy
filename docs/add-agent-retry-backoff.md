# Fix: Agent-Level Retry mit Exponential Backoff

## Problem

Das Anthropic SDK macht HTTP-Level-Retries (konfigurierbar via `maxRetries`), aber das reicht für zwei Szenarien nicht:

**Szenario A — Rate Limit:** Der Agent wirft sofort `AgentError("RATE_LIMITED")` und bricht ab. Der User bekommt einen 429-Error zurück, obwohl ein kurzes Warten das Problem gelöst hätte.

**Szenario B — Transient Tool Failure:** Ein Tool schlägt fehl (z.B. Qdrant kurz nicht erreichbar, externe API-Timeout). Der Fehler wird als `{ error: "..." }` an den LLM übergeben. Bei transienten Fehlern wäre ein Retry des Tool-Calls sinnvoller als dem LLM zu melden, dass das Tool "kaputt" ist.

## Warum das wichtig ist

Ein produktionsreifer Agent soll gegen kurzfristige Infrastruktur-Probleme resilient sein. Aktuell führt jeder 429 oder Netzwerk-Hickup zu einem User-sichtbaren Fehler. Das erzeugt eine schlechte UX und erfordert manuelle Retries.

## Lösung

### A — LLM-Call Retry mit Backoff (`agent.ts`)

`callLlm` um eine Retry-Schleife erweitern. Nur Rate-Limit-Fehler werden retried — API-Errors und unbekannte Fehler sofort weitergeworfen:

```typescript
async function callLlmWithRetry(
  llm: LLMClient,
  messages: Message[],
  tools: ToolRegistry,
  options: { maxAttempts: number; baseDelayMs: number },
  logger: Logger,
  onToken?: (delta: string) => void,
): Promise<LLMResponse> {
  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await callLlm(llm, messages, tools, onToken);
    } catch (error) {
      if (error instanceof AgentError && error.code === "RATE_LIMITED" && attempt < options.maxAttempts - 1) {
        const delayMs = options.baseDelayMs * 2 ** attempt; // 1s → 2s → 4s
        logger.warn("rate limited, retrying", { attempt: attempt + 1, delay_ms: delayMs });
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
  }
  throw new AgentError("RATE_LIMITED", `Rate limit exceeded after ${options.maxAttempts} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### B — Tool-Call Retry bei transienten Fehlern (`tools/types.ts` + `tools/registry.ts`)

Optionales `retryable`-Flag auf dem Tool-Interface — nur für idempotente Tools setzen (read-only Operationen wie Knowledge-Base-Suche, `fetchUrl`):

```typescript
// tools/types.ts
export interface Tool<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput>;
  retryable?: boolean; // default: false
}
```

In `ToolRegistry.execute`:

```typescript
async execute(name: string, args: unknown, timeoutMs = 30_000): Promise<unknown> {
  const tool = this.tools.get(name);
  if (!tool) throw new Error(`Tool not found: ${name}`);

  const parsed = tool.inputSchema.parse(args);
  const maxAttempts = tool.retryable ? 3 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await Promise.race([
        tool.execute(parsed),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    } catch (error) {
      if (attempt < maxAttempts - 1 && isTransientError(error)) {
        await sleep(500 * 2 ** attempt); // 500ms → 1s
        continue;
      }
      throw error;
    }
  }
}

function isTransientError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("fetch failed") ||
    msg.includes("timed out")
  );
}
```

### C — `AgentConfig` erweitern (`agent.ts`)

```typescript
export interface AgentConfig {
  // ...bestehende Felder...
  retry?: {
    maxAttempts?: number;  // default: 3
    baseDelayMs?: number;  // default: 1000
  };
}
```

Im `runAgent`-Aufruf:

```typescript
const retryOptions = {
  maxAttempts: config.retry?.maxAttempts ?? 3,
  baseDelayMs: config.retry?.baseDelayMs ?? 1000,
};
const response = await callLlmWithRetry(llm, messages, tools, retryOptions, logger, onToken);
```

### D — Tests (`__tests__/agent.test.ts`)

Neue Test-Cases:

- Mock-LLM wirft beim ersten Call 429, antwortet beim zweiten normal → Agent läuft erfolgreich durch, 1 Retry wurde geloggt
- Mock-LLM wirft 3x 429 → Agent wirft `AgentError("RATE_LIMITED")` nach allen Versuchen
- Mock-Tool mit `retryable: true` wirft 2x `ECONNRESET`, dann Erfolg → Tool-Result korrekt im Agent-Result
- Mock-Tool mit `retryable: false` wirft einmal → sofortiger Fehler, kein Retry

## Scope

| Datei | Änderung |
|---|---|
| `src/agent.ts` | `callLlmWithRetry`, `sleep`, `AgentConfig.retry` |
| `src/tools/types.ts` | `retryable`-Flag |
| `src/tools/registry.ts` | Retry-Logik in `execute`, `isTransientError` |
| `src/__tests__/agent.test.ts` | neue Test-Cases |