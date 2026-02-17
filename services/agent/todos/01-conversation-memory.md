# 01 — Session-basierte Konversationshistorie

## Problem

Jeder `runAgent()`-Aufruf startet mit einer leeren Message-History (`agent.ts:30-33`). Es gibt keinen Mechanismus, um Konversationen über mehrere HTTP-Requests hinweg fortzuführen. Der `AgentConfig` in `server.ts` ist ein Modul-Singleton ohne jeglichen Session-State. Für einen IT-Operations-Agenten ist das unbrauchbar — der Nutzer muss bei jedem Request den gesamten Kontext wiederholen.

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `src/server.ts` | Session-Store anlegen, Session-ID aus Request lesen, History vor/nach `runAgent()` pflegen |
| `src/agent.ts` | `runAgent()` Signatur erweitern: optionale `previousMessages: Message[]` akzeptieren |
| `src/llm/types.ts` | Keine Änderung nötig (`Message` ist bereits passend definiert) |

## Implementierungsschritte

### 1. Session-Store in `server.ts`

```typescript
// Einfacher In-Memory-Store, später durch Redis/DB ersetzbar
const sessions = new Map<string, Message[]>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 Minuten

function getOrCreateSession(sessionId: string): Message[] {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, []);
  }
  return sessions.get(sessionId)!;
}
```

### 2. Session-ID aus Request extrahieren

Die OpenAI-API hat kein natives Session-Konzept. Optionen:

- **Custom Header**: `X-Session-Id` — einfach, erfordert Client-Konfiguration
- **Aus `model`-Feld ableiten**: Nicht sinnvoll
- **Auto-generieren**: `crypto.randomUUID()` bei erstem Request, via Response-Header zurückgeben

Empfehlung: `X-Session-Id` Header. Wenn nicht gesetzt, wird eine neue Session erstellt und die ID im Response-Header `X-Session-Id` zurückgegeben.

```typescript
// In POST /v1/chat/completions Handler
const sessionId = c.req.header("x-session-id") ?? crypto.randomUUID();
const history = getOrCreateSession(sessionId);
c.header("x-session-id", sessionId);
```

### 3. `runAgent()` Signatur erweitern

```typescript
// agent.ts — vorher:
export async function runAgent(config: AgentConfig, userMessage: string): Promise<AgentResult>

// agent.ts — nachher:
export async function runAgent(
  config: AgentConfig,
  userMessage: string,
  previousMessages?: Message[]
): Promise<AgentResult>
```

In der Message-Initialisierung:

```typescript
const messages: Message[] = [
  { role: "system", content: systemPrompt },
  ...(previousMessages ?? []),
  { role: "user", content: userMessage },
];
```

### 4. History nach `runAgent()` aktualisieren

```typescript
// server.ts — nach runAgent()
history.push({ role: "user", content: lastUserMessage });
history.push({ role: "assistant", content: result.response });
```

### 5. Session-Cleanup (TTL)

```typescript
// Periodisches Aufräumen abgelaufener Sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, meta] of sessionMeta.entries()) {
    if (now - meta.lastAccess > SESSION_TTL_MS) {
      sessions.delete(id);
      sessionMeta.delete(id);
    }
  }
}, 60_000);
```

## Abhängigkeiten

- Keine. Kann unabhängig implementiert werden.
- Ergänzt sich mit **06-multi-turn-conversations** (dort geht es um die History innerhalb eines einzelnen Requests, hier um die Persistenz über Requests hinweg).

## Verifikation

1. **Manuell**: Zwei aufeinanderfolgende Requests mit gleicher `X-Session-Id` senden. Im zweiten Request auf den Kontext des ersten Bezug nehmen — der Agent sollte den Kontext kennen.
2. **Unit Test**: `runAgent()` mit `previousMessages` aufrufen und prüfen, dass die History in den LLM-Call einfließt (Mock-LLMClient).
3. **HTTP Test**: Hono `app.request()` mit Custom-Header, prüfen dass Response-Header `X-Session-Id` gesetzt ist.
4. **TTL Test**: Session anlegen, Timer simulieren, prüfen dass Session nach TTL gelöscht wird.
