# AI Agent Migration Plan: Von Monolith zu modularem ReAct-Agent

## Zielarchitektur

```
src/
├── main.ts
├── app.module.ts
├── ARCHITECTURE.md                  # Gesamtübersicht für KI-Agenten
│
├── config/
│   └── config.module.ts             # Bestehend, unverändert
│
├── llm/                             # LLM-Kommunikation
│   ├── LLM.md                       # Deep-Module Doku
│   ├── llm.module.ts
│   ├── llm-client.interface.ts      # Provider-agnostisches Interface
│   ├── llm-client.service.ts        # Implementierung (OpenAI-kompatibel)
│   └── llm.types.ts                 # Request/Response Types
│
├── session/                         # Konversationshistorie
│   ├── SESSION.md
│   ├── session.module.ts
│   ├── session.service.ts           # In-Memory Session Store
│   └── session.types.ts             # Session, Message Types
│
├── tools/                           # Tool-System
│   ├── TOOLS.md
│   ├── tools.module.ts
│   ├── tool.interface.ts            # Tool-Contract
│   ├── tool-registry.service.ts     # Registry: discover, validate, execute
│   └── vector-search/               # Erstes Tool
│       ├── vector-search.tool.ts    # Implementiert Tool-Interface
│       ├── vector-store.interface.ts # Vektor-DB agnostisch
│       └── pgvector.service.ts      # PGVector-Implementierung
│
├── agent/                           # ReAct-Kern
│   ├── AGENT.md
│   ├── agent.module.ts
│   ├── agent.service.ts             # ReAct-Loop Orchestrierung
│   └── prompts/
│       ├── system.prompt.ts         # System-Prompt mit Tool-Beschreibungen
│       └── react.prompt.ts          # ReAct-Format Instruktionen
│
├── api/                             # REST-Schnittstelle (ex-openai/)
│   ├── API.md
│   ├── api.module.ts
│   ├── api.controller.ts            # OpenWebUI-kompatibler Endpunkt
│   └── api.service.ts               # Request/Response Mapping
│
├── model/                           # Bestehende Domain-Modelle
│   └── (Chunk, Model, etc.)
│
└── utils/
    └── (colorize, stringComponents, etc.)
```

## Prinzipien

**Deep Modules**: Jedes Modul hat ein einfaches Interface aber versteckt Komplexität. Die `.md`-Datei pro Modul erklärt Verantwortlichkeit, öffentliches API und Designentscheidungen, sodass ein KI-Agent (Claude Code, Copilot) sich sofort zurechtfindet.

**Abhängigkeitsrichtung**: `api → agent → [llm, tools, session]`. Kein Modul kennt das darüberliegende.

**Interface-first**: `llm-client.interface.ts`, `tool.interface.ts`, `vector-store.interface.ts` definieren Contracts. Implementierungen sind austauschbar.

---

## Migrationsschritte

Jeder Schritt ist so geschnitten, dass der Agent danach lauffähig bleibt und manuell getestet werden kann.

### Phase 1: Fundamente legen (kein Funktionsbruch)

#### Schritt 1: ARCHITECTURE.md erstellen
- Erstelle `src/ARCHITECTURE.md` mit der Zielarchitektur, Modulbeschreibungen und Abhängigkeitsgraph
- Noch keine Codeänderungen

#### Schritt 2: LLM-Modul extrahieren
1. Erstelle `src/llm/llm.types.ts` mit Types:
   - `LlmMessage` (role, content)
   - `LlmCompletionRequest` (messages, model, stream, temperature, tools?)
   - `LlmCompletionResponse` (choices, usage)
   - `LlmStreamChunk` (delta, finish_reason)
2. Erstelle `src/llm/llm-client.interface.ts`:
   ```typescript
   export interface LlmClient {
     createCompletion(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
     createCompletionStream(request: LlmCompletionRequest): AsyncIterable<LlmStreamChunk>;
     listModels(): Promise<LlmModelInfo[]>;
   }
   ```
3. Erstelle `src/llm/llm-client.service.ts`: Implementierung die gegen das LLM-Gateway spricht. Extrahiere die bestehende Logik aus `openai.service.ts`.
4. Erstelle `src/llm/llm.module.ts`: Exportiert `LlmClientService`.
5. Erstelle `src/llm/LLM.md` mit Modulbeschreibung.
6. **Test**: `openai.service.ts` nutzt jetzt `LlmClientService` statt direkt HTTP-Calls zu machen. Alles muss wie vorher funktionieren.

#### Schritt 3: Session-Modul erstellen
1. Erstelle `src/session/session.types.ts`:
   - `SessionMessage` (role, content, toolCalls?, toolResults?)
   - `Session` (id, messages, createdAt, lastActiveAt)
2. Erstelle `src/session/session.service.ts`:
   - `createSession(): string` gibt Session-ID zurück
   - `getSession(id: string): Session`
   - `addMessage(sessionId: string, message: SessionMessage): void`
   - `getHistory(sessionId: string): SessionMessage[]`
   - In-Memory mit `Map<string, Session>`, optional TTL für Cleanup
3. Erstelle `src/session/session.module.ts` und `src/session/SESSION.md`.
4. **Test**: Modul ist eigenständig, noch nicht eingebunden. Unit-Test schreiben.

#### Schritt 4: Tool-Interface und Registry erstellen
1. Erstelle `src/tools/tool.interface.ts`:
   ```typescript
   export interface Tool {
     name: string;
     description: string;
     parameters: JsonSchema;       // JSON Schema für die Parameter
     execute(params: unknown): Promise<ToolResult>;
   }
   
   export interface ToolResult {
     success: boolean;
     data: unknown;
     error?: string;
   }
   ```
2. Erstelle `src/tools/tool-registry.service.ts`:
   - `register(tool: Tool): void`
   - `getTool(name: string): Tool`
   - `getAllTools(): Tool[]`
   - `getToolDescriptions(): ToolDescription[]` (für den System-Prompt)
3. Erstelle `src/tools/tools.module.ts` und `src/tools/TOOLS.md`.
4. **Test**: Registry ist eigenständig. Unit-Test: registrieren, abrufen, nicht-existentes Tool wirft Fehler.

### Phase 2: Bestehende Logik migrieren

#### Schritt 5: Vector-Search als Tool wrappen
1. Erstelle `src/tools/vector-search/vector-store.interface.ts`:
   ```typescript
   export interface VectorStore {
     queryPages(embedding: number[], limit: number): Promise<VectorResult[]>;
     queryChunks(embedding: number[], limit: number): Promise<VectorResult[]>;
   }
   ```
2. Erstelle `src/tools/vector-search/pgvector.service.ts`: Verschiebe die bestehende `pgvector.service.ts` Logik hierher, implementiere `VectorStore`.
3. Erstelle `src/tools/vector-search/vector-search.tool.ts`: Implementiert `Tool`-Interface, nutzt `VectorStore` intern.
4. Registriere das Tool im `ToolsModule`.
5. **Test**: RAG-Suche funktioniert wie vorher, aber jetzt über Tool-Interface.

#### Schritt 6: Agent-Modul mit ReAct-Loop erstellen
1. Erstelle `src/agent/prompts/system.prompt.ts`: Migriere den bestehenden Prompt, erweitere ihn um Tool-Beschreibungen.
2. Erstelle `src/agent/prompts/react.prompt.ts`: ReAct-Format Template:
   ```
   Thought: [Dein Denkprozess]
   Action: [tool_name]
   Action Input: [JSON Parameter]
   Observation: [Tool-Ergebnis, wird vom System eingefügt]
   ... (wiederholen bis Antwort bereit)
   Final Answer: [Antwort an den Nutzer]
   ```
3. Erstelle `src/agent/agent.service.ts`:
   - `processMessage(sessionId: string, userMessage: string, stream?: boolean)`
   - ReAct-Loop: System-Prompt bauen → LLM aufrufen → prüfen ob Tool-Call → Tool ausführen → Observation anhängen → LLM erneut aufrufen → bis Final Answer
   - Nutzt `SessionService` für Historie, `LlmClient` für LLM-Calls, `ToolRegistry` für Tools
   - Maximale Iterationen konfigurierbar (z.B. 5)
4. Erstelle `src/agent/agent.module.ts` und `src/agent/AGENT.md`.
5. **Test**: Agent kann eine Frage beantworten die kein Tool braucht. Agent kann eine Frage beantworten die das Vector-Search Tool nutzt.

#### Schritt 7: API-Modul umbauen
1. Benenne `src/openai/` um zu `src/api/`.
2. Benenne `openai.controller.ts` → `api.controller.ts`, `openai.service.ts` → `api.service.ts`.
3. `api.service.ts` delegiert an `AgentService` statt direkt LLM-Calls zu machen.
4. Controller-Routen bleiben identisch (OpenWebUI-kompatibel: `/v1/chat/completions`, `/v1/models`).
5. Erstelle `src/api/API.md`: Erklärt, dass die API bewusst OpenAI-kompatibel ist für OpenWebUI-Integration, und wie Request/Response gemappt werden.
6. **Test**: OpenWebUI kann weiterhin verbinden. Chat funktioniert. Streaming funktioniert.

### Phase 3: Absichern und dokumentieren

#### Schritt 8: Integration Tests schreiben
1. Test: Vollständiger ReAct-Loop mit Mock-LLM und Mock-VectorStore
2. Test: Streaming-Response durch den ganzen Stack
3. Test: Session-Persistenz über mehrere Nachrichten
4. Test: Tool-Fehler werden graceful behandelt

#### Schritt 9: Aufräumen
1. Lösche die alten Dateien (`openai/`, alte `pgvector/`, alte `prompts/`)
2. Aktualisiere `app.module.ts` auf die neue Modulstruktur
3. Prüfe dass keine toten Imports existieren
4. Aktualisiere `ARCHITECTURE.md` falls nötig

#### Schritt 10: Modul-Dokumentation finalisieren
1. Jede `.md`-Datei enthält:
   - Verantwortlichkeit (1-2 Sätze)
   - Öffentliches API (Interfaces und wichtige Methoden)
   - Designentscheidungen und Begründungen
   - Abhängigkeiten
   - Erweiterungshinweise (z.B. "Neues Tool hinzufügen: implementiere Tool-Interface, registriere in ToolsModule")

---

## Hinweise für die Implementierung

**ReAct-Loop Parsing**: Das LLM muss Thought/Action/Final Answer im Text-Output produzieren. Parse mit Regex oder strukturiertem Output. Alternativ: wenn das LLM-Gateway OpenAI function calling unterstützt, nutze das native Tool-Calling statt Text-Parsing. Entscheide dich für eines.

**Session-Cleanup**: Implementiere einen einfachen TTL-basierten Cleanup (z.B. Sessions nach 30 Minuten Inaktivität löschen). Ein `@Interval()` Decorator in NestJS reicht dafür.

**Streaming im ReAct-Loop**: Während der Agent Thought/Action Schritte durchläuft, streame nur die Final Answer an den Client. Zwischenschritte sind intern.

**Error Handling**: Jedes Tool-`execute()` fängt eigene Fehler und gibt `{ success: false, error: "..." }` zurück. Der Agent entscheidet, ob er es erneut versucht oder dem Nutzer den Fehler mitteilt.
