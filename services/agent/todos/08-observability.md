# 08 — Structured Logging und Tracing für Tool-Calls/LLM

## Problem

Aktuell gibt es nur `console.log`-Ausgaben hinter einem `verbose`-Flag in `agent.ts`. Das ist unzureichend für:

- **Debugging**: Kein strukturiertes Format, kein Parsing durch Log-Aggregatoren möglich
- **Tracing**: Keine Korrelation von Logs über einen Request hinweg (keine Request-/Trace-IDs)
- **Metriken**: Keine Messung von Tool-Call-Dauer, LLM-Latenz, Fehlerraten
- **Production Readiness**: `console.log` ist nicht für Production geeignet

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `src/logger.ts` | **Neu** — Logger-Setup mit pino |
| `src/server.ts` | Request-Logging Middleware, Trace-ID generieren |
| `src/agent.ts` | Strukturiertes Logging für Iterationen, Tool-Calls, LLM-Aufrufe |
| `src/llm/claude.ts` | LLM-Call-Dauer loggen |
| `src/tools/registry.ts` | Tool-Execution-Dauer und Fehler loggen |
| `package.json` | `pino` als Dependency hinzufügen |

## Implementierungsschritte

### 1. pino installieren

```bash
pnpm add pino
```

### 2. Logger-Modul erstellen (`src/logger.ts`)

```typescript
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export type Logger = pino.Logger;

export function createChildLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
```

### 3. Request-Middleware in `server.ts`

```typescript
import { createChildLogger } from "./logger.js";

app.use("*", async (c, next) => {
  const traceId = c.req.header("x-trace-id") ?? crypto.randomUUID();
  const requestLogger = createChildLogger({ traceId, path: c.req.path });

  // Logger im Context verfügbar machen
  c.set("logger", requestLogger);
  c.set("traceId", traceId);
  c.header("x-trace-id", traceId);

  const start = performance.now();
  await next();
  const duration = performance.now() - start;

  requestLogger.info({ status: c.res.status, durationMs: Math.round(duration) }, "request completed");
});
```

### 4. Strukturiertes Logging in `agent.ts`

```typescript
// Agent-Loop — pro Iteration
log.info({ iteration, messageCount: messages.length }, "starting LLM call");

const start = performance.now();
const response = await llm.chat(messages, tools.toDefinitions());
const llmDurationMs = Math.round(performance.now() - start);

log.info(
  {
    iteration,
    stopReason: response.stopReason,
    toolCallCount: response.toolCalls.length,
    llmDurationMs,
    usage: response.usage,
  },
  "LLM call completed",
);

// Pro Tool-Call
for (const toolCall of response.toolCalls) {
  const toolStart = performance.now();
  // ... execute ...
  log.info(
    {
      tool: toolCall.name,
      durationMs: Math.round(performance.now() - toolStart),
      isError,
    },
    "tool execution completed",
  );
}
```

### 5. Logger in Agent-Config aufnehmen

```typescript
// agent.ts
export interface AgentConfig {
  llm: LLMClient;
  tools: ToolRegistry;
  systemPrompt: string;
  maxIterations?: number;
  verbose?: boolean;       // Deprecated — durch log-level ersetzen
  logger?: Logger;         // NEU
}
```

### 6. Optionale OpenTelemetry-Integration (Stretch Goal)

```typescript
// Nur wenn @opentelemetry/api installiert ist
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("fredy-agent");

// In agent.ts
const span = tracer.startSpan("agent.run", { attributes: { iteration } });
// ... am Ende: span.end();
```

Dies ist optional und kann später hinzugefügt werden. Pino-basiertes Logging ist der erste Schritt.

## Abhängigkeiten

- Keine harte Abhängigkeit.
- Ergänzt **04-error-handling-retry** (Retry-Versuche loggen).
- Ergänzt **07-token-tracking** (Usage als strukturierte Log-Daten).

## Verifikation

1. **Manuell**: Request senden, Log-Output prüfen. Jeder Log-Eintrag sollte JSON sein mit `traceId`, `level`, `msg`, und kontextspezifischen Feldern.
2. **Trace-ID**: Zwei Requests senden. Prüfen, dass jeder Request eine eigene `traceId` hat und alle Logs eines Requests die gleiche `traceId` tragen.
3. **Log-Level**: `LOG_LEVEL=debug` → mehr Output. `LOG_LEVEL=warn` → nur Warnungen/Fehler.
4. **Tool-Metriken**: Prüfen, dass Tool-Call-Dauer (`durationMs`) in den Logs erscheint.
5. **Unit Test**: Logger-Mock injizieren, prüfen dass die erwarteten Log-Calls mit den richtigen Bindings erfolgen.
