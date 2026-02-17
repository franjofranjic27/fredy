# 04 — Retry-Logik, Rate Limits, Timeouts

## Problem

`claude.ts` ruft `client.messages.create()` ohne jegliche Fehlerbehandlung auf. Bei folgenden Szenarien schlägt der gesamte Agent-Aufruf fehl:

- **429 Too Many Requests**: Anthropic Rate Limits (besonders bei hohem Durchsatz)
- **500/502/503**: Temporäre API-Fehler
- **Netzwerk-Timeouts**: Verbindungsabbrüche
- **Overloaded API**: `overloaded_error` von Anthropic

Der Fehler propagiert direkt zum HTTP-Response, ohne dass ein Retry versucht wird. Das Anthropic SDK hat zwar eingebaute Retries (standardmäßig 2), aber:
1. Die Default-Konfiguration ist nicht explizit, nicht dokumentiert
2. Es gibt kein Logging bei Retries
3. Tool-Execution-Fehler (z.B. `fetch_url` Timeout) haben keinen Retry

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `src/llm/claude.ts` | Anthropic SDK Retry-Config explizit setzen, Timeout konfigurieren |
| `src/agent.ts` | Fehlerbehandlung im Agentic Loop verbessern |
| `src/server.ts` | HTTP-Error-Response mit passenden Status-Codes |

## Implementierungsschritte

### 1. Anthropic SDK Retry-Konfiguration explizit machen

```typescript
// claude.ts — bei Client-Erstellung
const client = new Anthropic({
  apiKey,
  maxRetries: 3,           // Default ist 2, wir erhöhen auf 3
  timeout: 120_000,        // 2 Minuten (Default: 10 Minuten — zu lang für HTTP-Requests)
});
```

Das SDK handhabt 429, 500, 502, 503, 504 automatisch mit Exponential Backoff. Explizit machen dokumentiert das Verhalten und macht es konfigurierbar.

### 2. ClaudeClientOptions erweitern

```typescript
export interface ClaudeClientOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  maxRetries?: number;    // NEU
  timeoutMs?: number;     // NEU
}
```

### 3. Fehlerklassifizierung im Agentic Loop

```typescript
// agent.ts — im Agentic Loop
try {
  const response = await llm.chat(messages, tools.toDefinitions());
  // ...
} catch (error) {
  // Unterscheide: Retriable vs. Fatal
  if (error instanceof Anthropic.APIError) {
    if (error.status === 429) {
      // Rate limit — SDK hat bereits Retries versucht und alle aufgebraucht
      throw new AgentError("RATE_LIMITED", "API rate limit exceeded after retries", error);
    }
    if (error.status >= 500) {
      throw new AgentError("API_ERROR", `API server error: ${error.status}`, error);
    }
  }
  throw new AgentError("UNKNOWN", `Unexpected error: ${error}`, error);
}
```

### 4. Typisierte Agent-Fehler

```typescript
// agent.ts oder eigene errors.ts
export class AgentError extends Error {
  constructor(
    public readonly code: "RATE_LIMITED" | "API_ERROR" | "MAX_ITERATIONS" | "TOOL_ERROR" | "UNKNOWN",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentError";
  }
}
```

### 5. HTTP-Error-Mapping in `server.ts`

```typescript
// server.ts — im catch-Block des POST-Handlers
} catch (error) {
  if (error instanceof AgentError) {
    const statusMap: Record<AgentError["code"], number> = {
      RATE_LIMITED: 429,
      API_ERROR: 502,
      MAX_ITERATIONS: 500,
      TOOL_ERROR: 500,
      UNKNOWN: 500,
    };
    return c.json(
      { error: { message: error.message, code: error.code } },
      statusMap[error.code],
    );
  }
  return c.json({ error: { message: "Internal server error" } }, 500);
}
```

### 6. Tool-Execution-Timeout

```typescript
// tools/registry.ts — Timeout-Wrapper für execute()
async execute(name: string, args: unknown, timeoutMs = 30_000): Promise<unknown> {
  const tool = this.tools.get(name);
  if (!tool) throw new Error(`Tool not found: ${name}`);

  const parsed = tool.inputSchema.parse(args);

  const result = await Promise.race([
    tool.execute(parsed),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);

  return result;
}
```

## Abhängigkeiten

- Keine harte Abhängigkeit.
- Sinnvoll vor **02-real-streaming**, da Streaming-Fehler schwieriger zu handhaben sind.
- **08-observability** ergänzt dies um strukturiertes Logging bei Retries.

## Verifikation

1. **Unit Test**: Mock-LLMClient der beim ersten Call einen 429 wirft. Prüfen, dass `AgentError` mit Code `RATE_LIMITED` geworfen wird.
2. **Unit Test**: Mock-Tool mit `setTimeout` > Timeout-Limit. Prüfen, dass Timeout-Fehler korrekt gefangen wird.
3. **HTTP Test**: Error-Response prüfen — korrekter HTTP-Status und JSON-Fehlerformat.
4. **Manuell**: Anthropic API Key temporär ungültig machen. Prüfen, dass ein sauberer 401/Fehler zurückkommt statt eines Stacktrace.
