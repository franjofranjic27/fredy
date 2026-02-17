# 02 — Echtes Token-Streaming durch den Agentic Loop

## Problem

`server.ts:50-85` simuliert Streaming: Der gesamte `runAgent()`-Aufruf läuft erst vollständig durch, dann wird der fertige Text in 20-Zeichen-Chunks als SSE gesendet (`CHUNK_SIZE = 20`). Das bringt keinen Latenz-Vorteil — der Nutzer wartet die volle Agent-Laufzeit ab, bevor das erste Token erscheint.

Für einen Agenten mit Tool-Calls (die mehrere Sekunden dauern können) ist das eine schlechte User Experience. Echtes Streaming würde:
- Tokens sofort anzeigen, sobald sie vom LLM kommen
- Tool-Call-Status-Events senden (`tool_start`, `tool_end`)
- Die wahrgenommene Latenz drastisch reduzieren

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `src/llm/types.ts` | Neues `LLMStreamClient` Interface mit `chatStream()` |
| `src/llm/claude.ts` | `client.messages.stream()` statt `.create()` implementieren |
| `src/agent.ts` | Streaming-Variante des Agentic Loop (`runAgentStream()`) |
| `src/server.ts` | SSE-Handler auf echtes Streaming umstellen |
| `src/openai-types.ts` | Keine Änderung nötig (Chunk-Builder existiert bereits) |

## Implementierungsschritte

### 1. Stream-Interface in `llm/types.ts`

```typescript
export interface LLMStreamEvent {
  type: "text_delta" | "tool_use_start" | "tool_use_delta" | "message_stop";
  text?: string;
  toolCall?: ToolCall;
}

export interface LLMStreamClient extends LLMClient {
  chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
  ): AsyncIterable<LLMStreamEvent>;
}
```

### 2. `chatStream()` in `claude.ts`

Das Anthropic SDK bietet `client.messages.stream()` mit Event-Emitter:

```typescript
async *chatStream(messages, tools?): AsyncGenerator<LLMStreamEvent> {
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemMessage?.content,
    messages: buildMessages(messages),
    tools: tools?.map(/* ... */),
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text_delta", text: event.delta.text };
    }
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      yield {
        type: "tool_use_start",
        toolCall: {
          id: event.content_block.id,
          name: event.content_block.name,
          arguments: {},
        },
      };
    }
    // ... tool_use_delta für Input-JSON-Fragmente
  }

  const finalMessage = await stream.finalMessage();
  yield { type: "message_stop" };
}
```

### 3. `runAgentStream()` in `agent.ts`

```typescript
export async function* runAgentStream(
  config: AgentConfig,
  userMessage: string,
): AsyncGenerator<AgentStreamEvent> {
  // Gleicher Loop wie runAgent(), aber:
  // - LLM-Aufrufe via chatStream()
  // - Text-Deltas werden sofort ge-yielded
  // - Vor/nach Tool-Execution werden Status-Events ge-yielded
  // - Tool-Results werden weiterhin synchron gesammelt und als Message zurückgefüttert

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const toolCalls: ToolCall[] = [];
    let textContent = "";

    for await (const event of llm.chatStream(messages, tools.toDefinitions())) {
      if (event.type === "text_delta") {
        yield { type: "token", text: event.text! };
        textContent += event.text!;
      }
      if (event.type === "tool_use_start") {
        toolCalls.push(event.toolCall!);
        yield { type: "tool_start", name: event.toolCall!.name };
      }
    }

    if (toolCalls.length === 0) return; // Fertig

    // Tool-Execution (mit Status-Events)
    for (const toolCall of toolCalls) {
      yield { type: "tool_executing", name: toolCall.name };
      const result = await tools.execute(toolCall.name, toolCall.arguments);
      yield { type: "tool_done", name: toolCall.name, result };
      // ... result in messages pushen
    }
  }
}
```

### 4. SSE-Handler in `server.ts`

```typescript
if (body.stream) {
  return c.newResponse(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: string) =>
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));

        for await (const event of runAgentStream(config, lastUserMessage)) {
          if (event.type === "token") {
            send(JSON.stringify(createCompletionChunk(id, event.text, null, MODEL_ID)));
          }
          // Optional: Tool-Status als Custom-Events
        }

        send(JSON.stringify(createCompletionChunk(id, null, "stop", MODEL_ID)));
        send("[DONE]");
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }
  );
}
```

## Abhängigkeiten

- Keine harte Abhängigkeit.
- Funktioniert besser zusammen mit **03-parallel-tool-calls** (Tool-Execution ist der Hauptflaschenhals beim Streaming).
- `runAgent()` (non-streaming) sollte für CLI und nicht-streaming Requests erhalten bleiben.

## Verifikation

1. **Manuell**: `curl` mit `--no-buffer` gegen den SSE-Endpunkt — Tokens sollten inkrementell erscheinen, nicht alle auf einmal.
2. **Timing-Test**: Zeit bis zum ersten Token messen — sollte < 2s sein (statt volle Agent-Laufzeit).
3. **Tool-Call-Test**: Request der Tool-Calls auslöst. Prüfen, dass Text-Tokens vor und nach dem Tool-Call ankommen.
4. **Open-WebUI**: Streaming-Antwort in der UI prüfen — Text sollte Wort für Wort erscheinen.
5. **Fallback**: Non-streaming Request (`"stream": false`) muss weiterhin funktionieren.
