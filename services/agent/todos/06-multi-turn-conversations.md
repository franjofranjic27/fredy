# 06 — Volle Konversationshistorie im Server

## Problem

`server.ts:50` extrahiert nur die **letzte** User-Message aus dem Request und verwirft die gesamte vorherige Konversation:

```typescript
// server.ts — aktueller Code
const lastMessage = body.messages[body.messages.length - 1];
const userMessage = lastMessage.content;

// Alles vor lastMessage wird ignoriert!
const result = await runAgent(config, userMessage);
```

OpenAI-kompatible Clients (wie Open-WebUI) senden bei jeder Anfrage die **vollständige** Konversationshistorie im `messages`-Array. Diese History wird aktuell weggeworfen.

Das bedeutet: Auch wenn Open-WebUI die bisherige Konversation mitsendet, antwortet der Agent immer nur auf die letzte Nachricht ohne Kontext.

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `src/server.ts` | Alle Messages aus dem Request an den Agent weiterreichen |
| `src/agent.ts` | `runAgent()` Signatur: `messages: Message[]` statt `userMessage: string` |
| `src/llm/types.ts` | Keine Änderung nötig |

## Implementierungsschritte

### 1. `runAgent()` Signatur erweitern

```typescript
// agent.ts — vorher:
export async function runAgent(
  config: AgentConfig,
  userMessage: string,
): Promise<AgentResult>

// agent.ts — nachher:
export async function runAgent(
  config: AgentConfig,
  messages: Message[],
): Promise<AgentResult>
```

### 2. Message-Initialisierung in `agent.ts` anpassen

```typescript
// agent.ts — vorher:
const messages: Message[] = [
  { role: "system", content: systemPrompt },
  { role: "user", content: userMessage },
];

// agent.ts — nachher:
const allMessages: Message[] = [
  { role: "system", content: systemPrompt },
  ...messages.filter((m) => m.role !== "system"), // System-Prompt kommt nur einmal, vom Agent
];
```

### 3. `server.ts` — Messages durchreichen

```typescript
// server.ts — vorher:
const lastMessage = body.messages[body.messages.length - 1];
const userMessage = lastMessage.content;
const result = await runAgent(config, userMessage);

// server.ts — nachher:
const result = await runAgent(config, body.messages);
```

### 4. CLI-Entrypoint (`index.ts`) anpassen

```typescript
// index.ts — vorher:
const result = await runAgent(config, userMessage);

// index.ts — nachher:
const result = await runAgent(config, [{ role: "user", content: userMessage }]);
```

### 5. OpenAI-Message-Format zu internem Format mappen

Die Messages aus dem Request sind bereits im Format `{ role, content }`, das mit `Message` aus `llm/types.ts` kompatibel ist. Das `ChatCompletionRequestSchema` in `openai-types.ts` validiert `role: z.enum(["system", "user", "assistant"])`, was exakt dem `Message`-Typ entspricht.

## Abhängigkeiten

- Ergänzt sich direkt mit **01-conversation-memory** (Server-seitige Persistenz). Dieses TODO behandelt das Weiterreichen der Client-seitigen History.
- Empfehlung: **06 vor 01** implementieren, da 06 die einfachere Änderung ist und den sofortigen Nutzen bringt (Open-WebUI sendet die History bereits).

## Verifikation

1. **Manuell mit Open-WebUI**: Konversation führen. Zweite Frage nimmt Bezug auf die erste. Prüfen, dass der Agent den Kontext versteht.
2. **HTTP Test**: Request mit `messages: [{role: "user", content: "Mein Name ist Alice"}, {role: "assistant", content: "Hallo Alice!"}, {role: "user", content: "Wie heiße ich?"}]` → Agent antwortet mit "Alice".
3. **CLI Test**: `index.ts` funktioniert weiterhin mit einem einzelnen String-Argument.
4. **Unit Test**: `runAgent()` mit mehreren Messages aufrufen. Mock-LLMClient prüft, dass alle Messages im `chat()`-Aufruf ankommen.
