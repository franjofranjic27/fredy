# 09 — Testplan: Unit, Integration, HTTP-API, E2E

## Problem

Der Agent-Service hat **keine einzige Test-Datei**, obwohl `vitest` (v4.0.18) als Dev-Dependency installiert ist und `"test": "vitest"` im `package.json` steht. Es gibt weder Unit Tests noch Integration Tests. Das bedeutet:

- Refactorings sind riskant (kein Sicherheitsnetz)
- Regressionen werden erst in Production entdeckt
- Neue Contributors haben keinen Weg, die Korrektheit ihrer Änderungen zu prüfen
- Die anderen TODOs (01–08) können nicht automatisiert verifiziert werden

## Betroffene Dateien

| Datei | Typ | Beschreibung |
|-------|-----|-------------|
| `vitest.config.ts` | **Neu** | Vitest-Konfiguration |
| `src/__tests__/tools/registry.test.ts` | **Neu** | Unit Tests für ToolRegistry |
| `src/__tests__/tools/example-tools.test.ts` | **Neu** | Unit Tests für einzelne Tools |
| `src/__tests__/llm/claude.test.ts` | **Neu** | Unit Tests für buildMessages, Response-Mapping |
| `src/__tests__/openai-types.test.ts` | **Neu** | Unit Tests für Request-Validation, Response-Builder |
| `src/__tests__/agent.test.ts` | **Neu** | Integration Tests für runAgent() |
| `src/__tests__/server.test.ts` | **Neu** | HTTP-API Tests |
| `src/__tests__/e2e/agent-e2e.test.ts` | **Neu** | E2E Tests (optional, CI-only) |
| `src/__tests__/helpers/mock-llm.ts` | **Neu** | Mock-LLMClient für Tests |

## Implementierungsschritte

### 1. Vitest-Konfiguration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["src/__tests__/e2e/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/index.ts"],
    },
  },
});
```

### 2. Mock-LLMClient Helper

```typescript
// src/__tests__/helpers/mock-llm.ts
import type { LLMClient, LLMResponse, Message, ToolDefinition } from "../../llm/types.js";

export function createMockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;
  const calls: Array<{ messages: Message[]; tools?: ToolDefinition[] }> = [];

  return {
    async chat(messages, tools) {
      calls.push({ messages, tools });
      if (callIndex >= responses.length) {
        throw new Error(`MockLLMClient: no more responses (call #${callIndex})`);
      }
      return responses[callIndex++];
    },
    // Expose calls for assertions
    get calls() { return calls; },
  } as LLMClient & { calls: typeof calls };
}
```

### 3. Unit Tests: ToolRegistry (`src/__tests__/tools/registry.test.ts`)

```typescript
describe("ToolRegistry", () => {
  it("should register and retrieve a tool", () => { /* ... */ });
  it("should list registered tool names", () => { /* ... */ });
  it("should execute a tool with valid input", async () => { /* ... */ });
  it("should throw on invalid input (Zod validation)", async () => { /* ... */ });
  it("should throw on unknown tool name", async () => { /* ... */ });
  it("should convert tools to LLM definitions with JSON Schema", () => { /* ... */ });
  it("should support fluent/chainable register()", () => { /* ... */ });
});
```

### 4. Unit Tests: Example Tools (`src/__tests__/tools/example-tools.test.ts`)

```typescript
describe("calculatorTool", () => {
  it("should evaluate basic arithmetic", async () => { /* 2 + 3 = 5 */ });
  it("should reject invalid expressions", async () => { /* letters, special chars */ });
});

describe("getCurrentTimeTool", () => {
  it("should return current datetime and timezone", async () => { /* ... */ });
});

describe("fetchUrlTool", () => {
  it("should fetch a URL and return status + body", async () => {
    // Requires mocking global fetch
  });
  it("should truncate body to 2000 chars", async () => { /* ... */ });
  it("should handle fetch errors", async () => { /* ... */ });
});
```

### 5. Unit Tests: claude.ts (`src/__tests__/llm/claude.test.ts`)

Die `buildMessages`-Funktion ist nicht exportiert, daher testen wir indirekt über den LLMClient oder exportieren sie für Tests:

```typescript
describe("buildMessages", () => {
  it("should exclude system messages from output", () => { /* ... */ });
  it("should map user and assistant messages", () => { /* ... */ });
  it("should append tool results as tool_result blocks", () => { /* ... */ });
});

describe("createClaudeClient", () => {
  it("should map Anthropic response to LLMResponse", async () => {
    // Requires mocking @anthropic-ai/sdk
  });
  it("should handle tool_use stop reason", async () => { /* ... */ });
  it("should handle end_turn stop reason", async () => { /* ... */ });
});
```

### 6. Unit Tests: openai-types.ts (`src/__tests__/openai-types.test.ts`)

```typescript
describe("ChatCompletionRequestSchema", () => {
  it("should validate a minimal request", () => { /* ... */ });
  it("should reject empty messages array", () => { /* ... */ });
  it("should default stream to false", () => { /* ... */ });
  it("should accept optional temperature and max_tokens", () => { /* ... */ });
});

describe("createCompletionResponse", () => {
  it("should create a valid OpenAI completion response", () => { /* ... */ });
  it("should include model and content", () => { /* ... */ });
});

describe("createCompletionChunk", () => {
  it("should create a valid SSE chunk", () => { /* ... */ });
  it("should handle null content for finish chunk", () => { /* ... */ });
});
```

### 7. Integration Tests: Agent (`src/__tests__/agent.test.ts`)

```typescript
describe("runAgent", () => {
  it("should return LLM response when no tools are called", async () => {
    const mockLLM = createMockLLMClient([
      { content: "Hello!", toolCalls: [], stopReason: "end_turn" },
    ]);
    const result = await runAgent({ llm: mockLLM, tools: new ToolRegistry(), ... }, "Hi");
    expect(result.response).toBe("Hello!");
    expect(result.iterations).toBe(1);
  });

  it("should execute tool calls and loop back to LLM", async () => {
    const mockLLM = createMockLLMClient([
      { content: null, toolCalls: [{ id: "1", name: "calculator", arguments: { expression: "2+2" } }], stopReason: "tool_use" },
      { content: "The answer is 4.", toolCalls: [], stopReason: "end_turn" },
    ]);
    const tools = new ToolRegistry().register(calculatorTool);
    const result = await runAgent({ llm: mockLLM, tools, ... }, "What is 2+2?");
    expect(result.response).toBe("The answer is 4.");
    expect(result.toolsUsed).toHaveLength(1);
    expect(result.iterations).toBe(2);
  });

  it("should throw on max iterations exceeded", async () => {
    // MockLLM that always returns tool_use
  });

  it("should handle tool execution errors gracefully", async () => {
    // Tool that throws, agent should catch and feed error back
  });
});
```

### 8. HTTP-API Tests (`src/__tests__/server.test.ts`)

Hono bietet `app.request()` für testbare HTTP-Aufrufe ohne echten Server:

```typescript
describe("GET /health", () => {
  it("should return 200 with status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /v1/models", () => {
  it("should return model list in OpenAI format", async () => { /* ... */ });
});

describe("POST /v1/chat/completions", () => {
  it("should return a completion response (non-streaming)", async () => { /* ... */ });
  it("should return SSE stream (streaming)", async () => { /* ... */ });
  it("should return 400 on invalid request body", async () => { /* ... */ });
});
```

Hinweis: Die HTTP-Tests benötigen entweder einen Mock des `AgentConfig` oder Dependency Injection in die Hono-App. Aktuell ist `config` ein Modul-Singleton — hier muss `server.ts` refactored werden, um die App testbar zu machen (z.B. `createApp(config): Hono`).

### 9. E2E Tests (optional, CI-only) (`src/__tests__/e2e/agent-e2e.test.ts`)

```typescript
describe.skipIf(!process.env.ANTHROPIC_API_KEY)("E2E: Agent with real Claude API", () => {
  it("should answer a simple question", async () => {
    const config = createAgentConfig();
    const result = await runAgent(config, "What is 2+2?");
    expect(result.response).toContain("4");
  });

  it("should use the calculator tool", async () => {
    const config = createAgentConfig();
    const result = await runAgent(config, "Calculate 17 * 42 using the calculator tool");
    expect(result.toolsUsed.some((t) => t.name === "calculator")).toBe(true);
  });
});
```

E2E Tests sind teuer (API-Kosten, Latenz) und werden nur ausgeführt, wenn `ANTHROPIC_API_KEY` gesetzt ist.

## Test-Scripts in package.json

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "vitest run --include 'src/__tests__/e2e/**'"
  }
}
```

## Abhängigkeiten

- Keine harte Abhängigkeit auf andere TODOs.
- **Sollte als erstes implementiert werden**, da Tests die Grundlage für alle weiteren Änderungen sind.
- Die anderen TODOs (01–08) referenzieren in ihrer Verifikation jeweils Tests, die hier definiert werden.

## Verifikation

1. `pnpm test:run` läuft durch ohne Fehler.
2. Alle Testgruppen (Unit, Integration, HTTP) sind vorhanden und grün.
3. `pnpm test:coverage` zeigt Coverage für `agent.ts`, `tools/registry.ts`, `llm/claude.ts`, `openai-types.ts`.
4. E2E Tests sind mit `describe.skipIf` markiert und überspringen ohne API-Key.
