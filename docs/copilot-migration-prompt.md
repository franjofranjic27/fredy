# Agent Migration: Anweisungsprompt für GitHub Copilot

Du bist ein erfahrener NestJS-Entwickler. Du migrierst einen bestehenden AI-Agent von einer monolithischen Struktur zu einer modularen ReAct-Architektur. 

## Kontext

Der Agent ist ein NestJS-Server, der sich als OpenAI-kompatible API ausgibt, damit er mit OpenWebUI verbunden werden kann. Dahinter kommuniziert er mit einem LLM-Gateway (OpenAI-kompatibles Protokoll). Er hat eine PGVector-Datenbank für RAG.

Lies zuerst `src/ARCHITECTURE.md` für die Zielarchitektur und den Migrationsplan.

## Regeln

- **Keine Funktionsbrüche**: Nach jedem Schritt muss der Server starten und über OpenWebUI nutzbar sein
- **Ein Schritt, ein Commit**: Bearbeite immer nur den aktuellen Schritt. Committe bevor du zum nächsten gehst
- **Interface-first**: Erstelle immer zuerst das Interface, dann die Implementierung
- **Deep Modules**: Jedes Modul bekommt eine `.md`-Datei die Verantwortlichkeit, öffentliches API, Designentscheidungen, Abhängigkeiten und Erweiterungshinweise dokumentiert
- **NestJS-Konventionen**: Nutze `@Module`, `@Injectable`, Provider-Tokens für Interfaces. Nutze `Symbol()` oder String-Tokens für Interface-Injection
- **Keine Overengineering**: Keine Abstraktionen ohne konkreten zweiten Use-Case. Das Interface für VectorStore und LlmClient ist gerechtfertigt, weil Migration auf andere Sprachen/Provider explizit geplant ist
- **Tests vor Refactoring**: Wenn du bestehende Logik verschiebst, schreibe zuerst einen Test der das aktuelle Verhalten absichert

## Abhängigkeitsrichtung

```
api → agent → [llm, tools, session]
                      ↓
               tool-implementierungen (vector-search)
                      ↓
               store-implementierungen (pgvector)
```

Kein Modul darf von einem darüberliegenden Modul abhängen.

## Schritte

Arbeite die folgenden Schritte **sequenziell** ab. Prüfe nach jedem Schritt ob der Server kompiliert und startet.

### Schritt 1: ARCHITECTURE.md
Erstelle `src/ARCHITECTURE.md` basierend auf dem Migrationsplan. Enthält: Zielstruktur als Tree, Modulbeschreibungen, Abhängigkeitsgraph als Mermaid-Diagramm.

### Schritt 2: LLM-Modul
1. Erstelle `src/llm/llm.types.ts` mit allen Types (LlmMessage, LlmCompletionRequest, LlmCompletionResponse, LlmStreamChunk, LlmModelInfo)
2. Erstelle `src/llm/llm-client.interface.ts` mit dem LlmClient Interface (createCompletion, createCompletionStream, listModels)
3. Erstelle `src/llm/llm-client.service.ts`: Extrahiere die HTTP-Kommunikation aus der bestehenden `openai.service.ts`. Implementiere das LlmClient Interface. Nutze die bestehende Config für LLM_BASE_URL und LLM_API_KEY
4. Erstelle `src/llm/llm.module.ts`: Exportiert LlmClientService mit Provider-Token `LLM_CLIENT`
5. Erstelle `src/llm/LLM.md`
6. Ändere `openai.service.ts` so dass es `LLM_CLIENT` injected und nutzt statt direkte HTTP-Calls
7. Aktualisiere `app.module.ts`
8. **Prüfe**: Server startet, OpenWebUI-Chat funktioniert

### Schritt 3: Session-Modul
1. Erstelle `src/session/session.types.ts` (Session, SessionMessage)
2. Erstelle `src/session/session.service.ts` mit In-Memory Store (Map), createSession, getSession, addMessage, getHistory, cleanup mit TTL
3. Erstelle `src/session/session.module.ts` und `src/session/SESSION.md`
4. Schreibe Unit-Tests: `session.service.spec.ts`
5. **Prüfe**: Tests grün, Server startet

### Schritt 4: Tool-System
1. Erstelle `src/tools/tool.interface.ts` (Tool, ToolResult, ToolDescription)
2. Erstelle `src/tools/tool-registry.service.ts` (register, getTool, getAllTools, getToolDescriptions)
3. Erstelle `src/tools/tools.module.ts` und `src/tools/TOOLS.md`
4. Schreibe Unit-Tests: `tool-registry.service.spec.ts`
5. **Prüfe**: Tests grün, Server startet

### Schritt 5: Vector-Search als Tool
1. Erstelle `src/tools/vector-search/vector-store.interface.ts` (VectorStore Interface)
2. Erstelle `src/tools/vector-search/pgvector.service.ts`: Verschiebe Logik aus bestehender `pgvector.service.ts`, implementiere VectorStore Interface. Nutze Provider-Token `VECTOR_STORE`
3. Erstelle `src/tools/vector-search/vector-search.tool.ts`: Implementiert Tool Interface, nutzt VectorStore intern
4. Registriere VectorSearchTool im ToolsModule via `onModuleInit`
5. Lösche oder deprecate die alte `pgvector/pgvector.service.ts` (nur löschen wenn keine anderen Referenzen)
6. **Prüfe**: Server startet

### Schritt 6: Agent-Modul (ReAct)
1. Erstelle `src/agent/prompts/system.prompt.ts`: Übernimm bestehenden Prompt aus `prompts/helpfulAssistant.ts`, erweitere um dynamische Tool-Beschreibungen
2. Erstelle `src/agent/prompts/react.prompt.ts`: ReAct-Instruktionen (Thought/Action/Observation/Final Answer Format)

   **Wichtig**: Prüfe zuerst ob das LLM-Gateway OpenAI function calling unterstützt. Falls ja, nutze das native Tool-Calling statt Text-Parsing. Falls nein, implementiere Text-basiertes ReAct mit Regex-Parsing.

3. Erstelle `src/agent/agent.service.ts`:
   - Methode `processMessage(sessionId: string, userMessage: string, options?: { stream?: boolean })` 
   - ReAct-Loop:
     ```
     1. System-Prompt mit Tool-Beschreibungen zusammenbauen
     2. Session-Historie laden
     3. User-Nachricht anhängen
     4. LLM aufrufen
     5. Response parsen: Tool-Call oder Final Answer?
     6. Bei Tool-Call: Tool ausführen, Observation anhängen, zurück zu 4
     7. Bei Final Answer: zurückgeben
     8. Max-Iterations als Safeguard (default: 5)
     ```
   - Methode `processMessageStream(sessionId: string, userMessage: string)`: Wie oben, aber streame nur die Final Answer. Zwischenschritte (Thought, Action, Observation) sind intern
4. Erstelle `src/agent/agent.module.ts`: Importiert LlmModule, ToolsModule, SessionModule
5. Erstelle `src/agent/AGENT.md`
6. **Prüfe**: Agent kann eine simple Frage ohne Tool beantworten (integrationstest oder manuell)

### Schritt 7: API-Modul umbauen
1. Erstelle `src/api/` Ordner
2. Kopiere `openai.controller.ts` → `src/api/api.controller.ts`, benenne Klasse um zu `ApiController`
3. Kopiere `openai.service.ts` → `src/api/api.service.ts`, benenne Klasse um zu `ApiService`
4. `ApiService` delegiert jetzt an `AgentService.processMessage()` und `AgentService.processMessageStream()` statt eigene LLM-Calls zu machen
5. Routen bleiben identisch: `POST /v1/chat/completions`, `GET /v1/models`
6. Erstelle `src/api/api.module.ts`: Importiert AgentModule
7. Erstelle `src/api/API.md`: Dokumentiere dass die API bewusst OpenAI-kompatibel bleibt
8. Aktualisiere `app.module.ts`: Ersetze OpenAI-Module durch ApiModule
9. Lösche `src/openai/`
10. **Prüfe**: OpenWebUI verbindet, Chat funktioniert, Streaming funktioniert

### Schritt 8: Integration Tests
1. Erstelle `test/agent.integration.spec.ts`: Mock LlmClient und VectorStore, teste:
   - Simple Frage → direkte Antwort (kein Tool)
   - RAG-Frage → Vector-Search Tool wird aufgerufen → Antwort enthält Context
   - Multi-Turn Konversation → Session-Historie wird korrekt genutzt
   - Tool-Fehler → Agent gibt sinnvolle Fehlermeldung
   - Max-Iterations erreicht → Agent bricht ab mit Nachricht
2. Erstelle `test/api.integration.spec.ts`: HTTP-Level Tests gegen die OpenAI-kompatiblen Endpunkte

### Schritt 9: Aufräumen
1. Lösche alte Verzeichnisse und Dateien die nicht mehr referenziert werden
2. Prüfe alle Imports auf tote Referenzen: `npx ts-unused-exports tsconfig.json`
3. Stelle sicher dass `app.module.ts` nur noch die neuen Module importiert
4. Finaler manueller Test über OpenWebUI

### Schritt 10: Dokumentation finalisieren
Prüfe und vervollständige alle `.md` Dateien. Jede muss enthalten:
- **Verantwortlichkeit**: 1-2 Sätze, was das Modul tut
- **Öffentliches API**: Interfaces und Methoden die von aussen genutzt werden
- **Designentscheidungen**: Warum so und nicht anders
- **Abhängigkeiten**: Was wird importiert
- **Erweiterung**: Wie fügt man z.B. ein neues Tool, einen neuen LLM-Provider oder einen neuen VectorStore hinzu

## Wichtige Designentscheidungen

### Provider-Tokens für Interfaces
NestJS kann keine TypeScript Interfaces direkt injecten. Nutze Provider-Tokens:
```typescript
// In llm.module.ts
export const LLM_CLIENT = Symbol('LLM_CLIENT');

@Module({
  providers: [
    { provide: LLM_CLIENT, useClass: LlmClientService },
  ],
  exports: [LLM_CLIENT],
})

// In consumer
constructor(@Inject(LLM_CLIENT) private readonly llmClient: LlmClient) {}
```

### Tool-Registrierung
Tools registrieren sich selbst via `onModuleInit`:
```typescript
@Injectable()
export class VectorSearchTool implements Tool, OnModuleInit {
  constructor(private readonly registry: ToolRegistryService) {}
  
  onModuleInit() {
    this.registry.register(this);
  }
}
```

### ReAct vs Function Calling
Prüfe ob das LLM-Gateway `/v1/chat/completions` mit `tools` Parameter unterstützt. Falls ja, ist native Function Calling robuster als Text-Parsing. Falls nein, nutze Text-basiertes ReAct. Dokumentiere die Entscheidung in `AGENT.md`.

### Session-ID Mapping
OpenWebUI sendet keine Session-ID. Optionen:
1. Generiere eine Session pro Request (stateless, kein Multi-Turn)
2. Nutze einen Hash der ersten User-Nachricht als Session-Key
3. Erweitere den API-Layer um einen custom Header

Empfehlung: Option 1 als Start, dann Option 3 wenn Multi-Turn benötigt wird. Dokumentiere in `SESSION.md`.
