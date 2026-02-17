# 03 — Parallele Tool-Ausführung mit Promise.all

## Problem

Claude kann in einer einzigen Response mehrere Tool-Calls gleichzeitig anfordern (z.B. `get_current_time` + `calculator` + `fetch_url`). Der Agentic Loop in `agent.ts:59-87` iteriert jedoch sequentiell mit `for...of`:

```typescript
// agent.ts:69-87 — aktueller Code
for (const toolCall of response.toolCalls) {
  let result: unknown;
  let isError = false;
  try {
    result = await tools.execute(toolCall.name, toolCall.arguments);
  } catch (error) {
    // ...
  }
  // ...
}
```

Bei drei Tool-Calls mit je 1s Latenz dauert das 3s statt 1s. Besonders `fetch_url` und `search_knowledge_base` haben signifikante Netzwerk-Latenz.

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `src/agent.ts` | `for...of` Loop durch `Promise.all()` ersetzen |

## Implementierungsschritte

### 1. Sequentiellen Loop durch Promise.all ersetzen

```typescript
// agent.ts — vorher (sequentiell):
const toolResults: ToolResult[] = [];
for (const toolCall of response.toolCalls) {
  // await each one...
}

// agent.ts — nachher (parallel):
const toolExecutions = response.toolCalls.map(async (toolCall) => {
  let result: unknown;
  let isError = false;
  try {
    result = await tools.execute(toolCall.name, toolCall.arguments);
  } catch (error) {
    isError = true;
    result = { error: error instanceof Error ? error.message : String(error) };
  }

  return {
    toolUsed: { name: toolCall.name, input: toolCall.arguments, output: result },
    toolResult: {
      toolCallId: toolCall.id,
      content: JSON.stringify(result),
      isError,
    } satisfies ToolResult,
  };
});

const results = await Promise.all(toolExecutions);

// Ergebnisse in die bestehenden Arrays einsortieren
for (const { toolUsed, toolResult } of results) {
  toolsUsed.push(toolUsed);
  toolResults.push(toolResult);
}
```

### 2. Reihenfolge der Results beibehalten

`Promise.all()` garantiert, dass die Ergebnisse in der gleichen Reihenfolge wie die Input-Promises zurückkommen. Die Zuordnung `toolCallId → result` bleibt also korrekt.

### 3. Verbose-Logging anpassen

```typescript
if (verbose) {
  console.log(`Executing ${response.toolCalls.length} tool calls in parallel...`);
  for (const { toolUsed } of results) {
    console.log(`  - ${toolUsed.name}: ${JSON.stringify(toolUsed.output).slice(0, 200)}`);
  }
}
```

## Abhängigkeiten

- Keine. Diese Änderung ist minimal und rückwärtskompatibel.
- Bei nur einem Tool-Call verhält sich `Promise.all([singlePromise])` identisch zum sequentiellen Code.

## Verifikation

1. **Unit Test**: `runAgent()` mit Mock-LLMClient der zwei Tool-Calls zurückgibt. Mock-Tools mit `setTimeout` versehen. Prüfen, dass die Gesamtdauer näher an `max(tool1, tool2)` als an `tool1 + tool2` liegt.
2. **Manuell**: Request wie *"What time is it and what is 42 * 17?"* — Claude sollte beide Tools parallel aufrufen. Im Verbose-Log prüfen, dass beide fast gleichzeitig ausgeführt werden.
3. **Fehler-Test**: Ein Tool wirft einen Fehler, das andere nicht. Prüfen, dass `Promise.all` den Fehler korrekt auffängt (da der try/catch im `.map()` Callback ist, nicht um `Promise.all` herum).
4. **Reihenfolge-Test**: Prüfen, dass `toolResults` in der gleichen Reihenfolge wie `toolCalls` sind.
