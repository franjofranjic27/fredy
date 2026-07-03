# Agent-Flow: Verarbeitung einer Chat-Anfrage

Dieses Dokument beschreibt den vollständigen Ablauf einer Nutzeranfrage durch den Fredy-Agentendienst – von der HTTP-Anfrage bis zur gestreamten Antwort. Es dient als Grundlage für ein Sequenz- oder Flussdiagramm.

---

## Akteure / Komponenten

| Kürzel | Komponente | Datei |
|--------|-----------|-------|
| **Client** | Open-WebUI / HTTP-Client | – |
| **Server** | Hono HTTP-Server | `server.ts` |
| **Auth** | JWT- / API-Key-Middleware | `auth.ts` |
| **RBAC** | Role-Based Access Control | `rbac.ts` |
| **Session** | Session Store (In-Memory) | `session/` |
| **Agent** | Agenten-Orchestrierung (ReAct-Loop) | `agent.ts` |
| **ModelClient** | LLM-Abstraktionsschicht | `llm/claude.ts` |
| **Claude** | Anthropic Claude API | extern |
| **ToolRegistry** | Werkzeugregister | `tools/registry.ts` |
| **RAG-Tool** | `search_knowledge_base` | `tools/knowledge-base.ts` |
| **Stats-Tool** | `get_knowledge_base_stats` | `tools/ops-tools.ts` |
| **EmbeddingAPI** | OpenAI / Voyage Embeddings | extern |
| **pgvector** | PostgreSQL-Vektordatenbank (Tabelle `chunks`) | extern |

---

## Schritt-für-Schritt-Flow

### Phase 1 – HTTP-Eingang & Authentifizierung

```
1.  Client → POST /v1/chat/completions
      Header: Authorization: Bearer <token>
      Header: x-session-id: <uuid>          (optional)
      Body:   { messages: [...], stream: true }

2.  Server: Request-Timing-Middleware startet Stoppuhr

3.  Server → Auth-Middleware
      IF KEYCLOAK_JWKS_URL gesetzt:
        → JWT validieren (verifyToken)
        → Rolle aus Claims extrahieren (extractRoleFromClaims)
        → jwtRole im Request-Context speichern
      ELSE (Dev-Modus):
        → statischen AGENT_API_KEY prüfen
        → jwtRole = null

4.  Server: Rate-Limit prüfen (Token-Bucket, RPM-Limit)
      → 429 zurückgeben, wenn überschritten
```

### Phase 2 – Session & RBAC

```
5.  Server: Session laden
      sessionId = x-session-id Header ODER neue UUID generieren
      session = SessionStore.get(sessionId)
      Falls neu: session = { messages: [], lastActivity: now }

6.  Server → RBAC
      role = resolveRole(headers, jwtRole)
      tools = buildFilteredRegistry(allTools, role, roleToolConfig)
      → nur erlaubte Werkzeuge werden dem Agent übergeben
```

### Phase 3 – Kontext-Aufbau

```
7.  Agent: Nachrichten-Kontext zusammenstellen
      messages = [
        { role: "system",    content: SYSTEM_PROMPT },  // definiert Rolle & Verhalten
        ...session.messages,                             // bisheriger Gesprächsverlauf
        ...inputMessages (ohne system),                  // aktuelle Nutzeranfrage
      ]
      → Kontinuität über mehrere Anfragen hinweg
```

### Phase 4 – ReAct-Loop (Kernlogik)

Der Agent iteriert maximal `maxIterations` (Standard: 10) Mal durch den folgenden Zyklus:

```
8.  ┌─ ITERATION START ─────────────────────────────────────────┐
    │                                                            │
    │  Agent → ModelClient.chat(messages, toolDefinitions)       │
    │    → Claude API: messages.create / messages.stream         │
    │    → Claude denkt (Reasoning-Phase):                       │
    │        Welche Informationen fehlen?                        │
    │        Reichen die Infos für eine Antwort?                 │
    │                                                            │
    │  IF stream=true: Token-Deltas werden sofort via            │
    │    onDelta-Callback → SSE an Client weitergeleitet         │
    │                                                            │
    │  Claude antwortet mit stopReason:                          │
    │    ┌── "end_turn"  → Antwort ist fertig → Loop endet       │
    │    └── "tool_use"  → Tool-Call(s) nötig → weiter          │
    │                                                            │
    └────────────────────────────────────────────────────────────┘

9.  IF tool_use:
      Alle Tool-Calls werden PARALLEL ausgeführt:

      FOR EACH toolCall IN response.toolCalls:
        ToolRegistry.execute(toolCall.name, toolCall.arguments)
          → Input-Validierung via Zod-Schema
          → 30s Timeout-Schutz
          → Tool-Funktion ausführen (siehe Phase 5)

      Tool-Ergebnisse als neue user-Nachricht anhängen:
        messages.push({
          role: "user",
          content: 'Tool "X" returned: {...}'
        })

      → GOTO 8 (nächste Iteration)
```

### Phase 5 – Tool-Ausführung (RAG)

#### Tool A: `search_knowledge_base`

```
10. RAG-Tool aufgerufen mit { query, limit?, spaceKey? }

11. RAG-Tool → Embedding API (OpenAI oder Voyage)
      POST /v1/embeddings
        { model: "text-embedding-3-small", input: query }
      → Rückgabe: Vektor [0.12, -0.34, ...]  (z. B. 1536 Dimensionen)

12. RAG-Tool → PostgreSQL / pgvector (Tabelle `chunks`)
      SELECT chunk_id, title, content, url, space_key,
             1 - (embedding <=> $1) AS score
        FROM chunks
       WHERE 1 - (embedding <=> $1) >= 0.7
         AND space_key = $2            -- optional
    ORDER BY embedding <=> $1
       LIMIT 5;
      → Rückgabe: Top-K ähnlichste Dokument-Chunks
          [{ title, content, url, spaceKey, score }, ...]

13. RAG-Tool → Agent: Ergebnisse zurück
      { results: [...], totalFound: N }

14. Agent: Ergebnisse als Tool-Result in Kontext einbetten
    → Nächster LLM-Aufruf enthält die gefundenen Dokument-Abschnitte
    → Claude generiert Antwort basierend auf echtem Wissen aus der Wissensbasis
```

#### Tool B: `get_knowledge_base_stats`

```
15. Stats-Tool aufgerufen (keine Parameter)

16. Stats-Tool → PostgreSQL / pgvector (Tabelle `chunks`)
      SELECT count(*) FROM chunks                              → totalChunks
      SELECT space_key, count(*) FROM chunks GROUP BY space_key → spaceKey-Verteilung

17. Stats-Tool → Agent:
      { table, totalChunks, spaces: [{spaceKey, chunkCount}], status }
```

### Phase 6 – Antwort-Ausgabe

```
18. Agent-Loop endet (stopReason = "end_turn")
    AgentResult = {
      response:   "<finale Antwort als Text>",
      toolsUsed:  [{ name, input, output }, ...],
      iterations: N,
      usage:      { inputTokens, outputTokens }
    }

19. Server → Session aktualisieren
      session.messages.push(
        { role: "user",      content: lastUserMessage },
        { role: "assistant", content: finalResponse  }
      )
      SessionStore.set(sessionId, session)

20. IF stream=true:
      SSE-Stream bereits laufend (Token-Deltas seit Schritt 8)
      → Abschluss-Chunk senden: { finish_reason: "stop" }
      → [DONE] senden
      → Header x-session-id zurückgeben

    IF stream=false:
      → JSON-Response zurückgeben (OpenAI-kompatibles Format)
      → createCompletionResponse(response, "rag-agent", usage)
```

---

## Vollständiger Flow auf einen Blick

```
Client
  │
  ▼
POST /v1/chat/completions
  │
  ├─ [Auth] JWT / API-Key prüfen
  ├─ [Rate Limit] Token-Bucket prüfen
  ├─ [Session] Gesprächsverlauf laden
  ├─ [RBAC] Erlaubte Tools filtern
  │
  ▼
Agent.runAgent()
  │
  ├─ Kontext aufbauen: System-Prompt + History + Input
  │
  └─ ReAct-Loop (max. 10 Iterationen):
       │
       ├─ ModelClient → Claude API
       │    └─ (stream) Token-Deltas → SSE → Client
       │
       ├─ stopReason = "end_turn"?
       │    └─ YES → Antwort zurückgeben → Loop ENDE
       │
       └─ stopReason = "tool_use"?
            └─ YES → Tools parallel ausführen:
                 │
                 ├─ search_knowledge_base:
                 │    ├─ Query → Embedding API → Vektor
                 │    └─ Vektor → pgvector (chunks) → Top-K Chunks
                 │
                 └─ get_knowledge_base_stats:
                      └─ pgvector (chunks) → Statistiken
                 │
                 └─ Tool-Ergebnisse in Kontext einbetten
                 └─ Nächste Iteration ↑
  │
  ▼
Session speichern
  │
  ▼
Response → Client
  (SSE-Stream ODER JSON)
```

---

## Wichtige Designentscheidungen für das Diagramm

| Aspekt | Implementierung | Relevanz |
|--------|----------------|----------|
| **Streaming** | SSE (Server-Sent Events) – Token-Deltas ab erstem LLM-Aufruf | Zeigt wahrgenommene Schnelligkeit |
| **Model-Abstraktion** | `LLMClient`-Interface – austauschbar (Claude / OpenAI / Gemini) | Zeigt Entkoppelung vom Anbieter |
| **ReAct-Muster** | Iterativer Loop mit Tool-Feedback | Zentrale Architektur-Eigenschaft |
| **Parallele Tools** | `Promise.all()` für mehrere Tool-Calls pro Iteration | Effizienz-Aspekt |
| **Session** | In-Memory (TTL 30 Min.) | Gesprächsgedächtnis |
| **RBAC** | Rolle aus JWT → gefiltertes ToolRegistry | Sicherheitsmerkmal |
| **RAG-Embedding** | Nutzerprompt wird vektorisiert, nicht die Antwort | Kernprinzip der semantischen Suche |