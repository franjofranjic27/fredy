# 07 — Token-Usage aus Claude-Response auslesen und weiterreichen

## Problem

Die OpenAI-kompatible Response in `server.ts` enthält ein `usage`-Objekt, das immer `{prompt_tokens: 0, completion_tokens: 0, total_tokens: 0}` zurückgibt (hartcodiert in `openai-types.ts:createCompletionResponse()`). Die Anthropic API liefert bei jedem Aufruf ein `response.usage`-Objekt mit `{input_tokens, output_tokens}`, das aktuell in `claude.ts` komplett ignoriert wird.

Token-Tracking ist relevant für:
- **Kosten-Monitoring**: Verbrauch pro Request/Session nachvollziehen
- **Client-Kompatibilität**: Open-WebUI und andere Clients zeigen Token-Verbrauch an
- **Budget-Limits**: Grundlage für zukünftige Rate-Limiting-Logik

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `src/llm/types.ts` | `usage` Feld zu `LLMResponse` hinzufügen |
| `src/llm/claude.ts` | `response.usage` auslesen und in `LLMResponse` aufnehmen |
| `src/agent.ts` | Usage über alle Iterationen akkumulieren, in `AgentResult` aufnehmen |
| `src/openai-types.ts` | `createCompletionResponse()` um Usage-Parameter erweitern |
| `src/server.ts` | Akkumulierte Usage aus `AgentResult` in die HTTP-Response durchreichen |

## Implementierungsschritte

### 1. `TokenUsage` Typ in `llm/types.ts`

```typescript
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: TokenUsage;  // NEU
}
```

### 2. Usage aus Anthropic-Response auslesen in `claude.ts`

```typescript
// claude.ts — in chat()
return {
  content: textContent?.type === "text" ? textContent.text : null,
  toolCalls: /* ... */,
  stopReason: /* ... */,
  usage: {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  },
};
```

### 3. Usage akkumulieren in `agent.ts`

```typescript
// agent.ts
export interface AgentResult {
  response: string;
  toolsUsed: Array<{ name: string; input: unknown; output: unknown }>;
  iterations: number;
  usage: TokenUsage;  // NEU — akkumuliert über alle Iterationen
}

export async function runAgent(config, userMessage): Promise<AgentResult> {
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await llm.chat(messages, tools.toDefinitions());

    // Akkumulieren
    totalUsage.inputTokens += response.usage.inputTokens;
    totalUsage.outputTokens += response.usage.outputTokens;

    if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
      return {
        response: response.content ?? "",
        toolsUsed,
        iterations: iteration + 1,
        usage: totalUsage,
      };
    }
    // ... Tool-Execution ...
  }
}
```

### 4. `createCompletionResponse()` erweitern in `openai-types.ts`

```typescript
// openai-types.ts — vorher:
export function createCompletionResponse(content: string, model: string)

// openai-types.ts — nachher:
export function createCompletionResponse(
  content: string,
  model: string,
  usage?: { promptTokens: number; completionTokens: number },
) {
  return {
    // ...
    usage: {
      prompt_tokens: usage?.promptTokens ?? 0,
      completion_tokens: usage?.completionTokens ?? 0,
      total_tokens: (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0),
    },
  };
}
```

### 5. Usage durchreichen in `server.ts`

```typescript
// server.ts
const result = await runAgent(config, lastUserMessage);

return c.json(createCompletionResponse(result.response, MODEL_ID, {
  promptTokens: result.usage.inputTokens,
  completionTokens: result.usage.outputTokens,
}));
```

## Abhängigkeiten

- Keine harte Abhängigkeit.
- Ergänzt sich mit **08-observability** (Usage als Metrik loggen).

## Verifikation

1. **Unit Test**: Mock-LLMClient gibt definierte Usage-Werte zurück. Prüfen, dass `AgentResult.usage` die Summe über alle Iterationen enthält.
2. **Unit Test**: Mehrere Iterationen (Tool-Calls) mit je unterschiedlicher Usage. Prüfen, dass Input- und Output-Tokens korrekt addiert werden.
3. **HTTP Test**: Response-Body enthält `usage.prompt_tokens > 0` und `usage.completion_tokens > 0`.
4. **Manuell**: In Open-WebUI prüfen, ob Token-Verbrauch angezeigt wird (sofern die UI das unterstützt).
