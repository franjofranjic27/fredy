# Fix: Tool Message History Format im Agent Loop

## Problem

In `services/agent/src/agent.ts:167–183` baut der Iterations-Loop die Message-History falsch auf.

Die Anthropic API hat eine strikte Konvention: Wenn ein Assistant-Response `tool_use`-Blöcke enthält, **muss** der nächste User-Turn `tool_result`-Content-Blöcke mit den passenden Tool-Call-IDs enthalten. Aktuell wird stattdessen:

- nur der Text-Content des Assistant gespeichert (die `tool_use`-Blöcke werden verworfen)
- die Tool-Results als plain-text User-Message eingefügt

```typescript
// IST (falsch):
if (response.content) {
  messages.push({ role: "assistant", content: response.content });
}
messages.push({
  role: "user",
  content: results
    .map(({ toolUsed, toolResult }) => `Tool "${toolUsed.name}" returned: ${toolResult.content}`)
    .join("\n\n"),
});
```

## Warum das wichtig ist

Das SDK akzeptiert plain text ohne Fehler, aber der Model "weiß" in Iteration 2+ nicht mehr, was er in Iteration 1 aufgerufen hat — die `tool_use`-Blöcke fehlen in der History. Bei 1–2 Iterationen kaum merkbar; bei komplexen Chains mit mehreren Tool-Calls führt das zu inkonsistentem Reasoning: das Model wiederholt Tools, verliert den Aktions-Kontext oder halluziniert über eigene Entscheidungen.

## Lösung

### 1. Message-Typ erweitern (`llm/types.ts`)

`Message.content` muss strukturierte Blöcke tragen können, nicht nur einen String:

```typescript
export type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
    >;

export interface Message {
  role: "user" | "assistant" | "system";
  content: MessageContent;
}
```

### 2. `buildMessages` anpassen (`llm/claude.ts`)

Die Funktion muss strukturierte Content-Blöcke direkt an die Anthropic API durchreichen. Das Anthropic SDK akzeptiert `ContentBlock[]` als `content`:

```typescript
function buildMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content, // string oder ContentBlock[] — SDK versteht beides
    }));
}
```

### 3. Agent-Loop korrigieren (`agent.ts`)

```typescript
// Assistant-Turn: Text + tool_use-Blöcke korrekt zusammenbauen
messages.push({
  role: "assistant",
  content: [
    ...(response.content ? [{ type: "text" as const, text: response.content }] : []),
    ...response.toolCalls.map((tc) => ({
      type: "tool_use" as const,
      id: tc.id,
      name: tc.name,
      input: tc.arguments,
    })),
  ],
});

// User-Turn: tool_result-Blöcke mit passenden IDs
messages.push({
  role: "user",
  content: results.map(({ toolResult }) => ({
    type: "tool_result" as const,
    tool_use_id: toolResult.toolCallId,
    content: toolResult.content,
    is_error: toolResult.isError,
  })),
});
```

### 4. Ollama-Client prüfen (`llm/ollama.ts`)

Ollama verwendet das OpenAI-Format. Dort heißen Tool-Results `tool`-Role-Messages mit `tool_call_id`. Analog prüfen und ggf. anpassen.

### 5. Tests aktualisieren (`__tests__/agent.test.ts`)

- Mock-LLM und Assertions auf strukturierte Content-Blöcke umstellen
- Neuer Test: Agent macht 2 Iterationen mit Tool-Call → prüfen, dass Iteration 2 die korrekten `tool_use`/`tool_result`-Blöcke in der History hat

## Scope

| Datei | Änderung |
|---|---|
| `src/llm/types.ts` | `MessageContent`-Typ |
| `src/llm/claude.ts` | `buildMessages` |
| `src/agent.ts` | Loop-Nachrichtenaufbau |
| `src/llm/ollama.ts` | Analog prüfen |
| `src/__tests__/agent.test.ts` | Test-Anpassungen |