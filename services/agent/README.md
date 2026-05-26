# Fredy Agent Service

NestJS service that exposes a deterministic RAG agent over an OpenAI-compatible HTTP API and over the Model Context Protocol (stdio). The agent grounds every answer in Confluence content retrieved from Qdrant — there is no open-ended ReAct loop.

## Architecture

```
src/
├── main.ts                     NestExpressApplication bootstrap (HTTP)
├── cli.ts                      Single-shot RAG run from the terminal
├── app.module.ts               Root module
├── tracing-init.ts             Loaded first; starts the OpenTelemetry NodeSDK
│
├── agents/
│   └── rag-agent/              Deterministic flow: rewrite → retrieve → assemble → LLM
│       ├── rag-agent.service.ts        Orchestrator
│       ├── retrieval.service.ts        Always calls vector_search
│       ├── query-rewrite.service.ts    Heuristic expansion (≤5 queries)
│       ├── prompt-assembler.service.ts Token-budget enforcement
│       ├── response-recorder.service.ts Persists session + emits AgentLogEvent
│       └── prompts/                    System prompt + builder
│
├── entry-points/
│   ├── web/                    /health, /v1/models, /v1/chat/completions (SSE)
│   └── mcp/                    MCP stdio server exposing the tool registry
│
├── auth/
│   ├── services/jwt.service.ts          JWKS verification (jose, lazy-loaded)
│   ├── services/rbac.service.ts         ROLE_TOOL_CONFIG parsing
│   ├── guards/keycloak-auth.guard.ts    Bearer-token / API-key check
│   └── guards/rbac.guard.ts             Computes request.allowedToolNames
│
├── middleware/
│   └── rate-limit.interceptor.ts        Token-bucket per client IP
│
├── shared/
│   ├── llm/                    LlmRegistry + Anthropic, OpenAI, Gemini, Ollama clients
│   ├── embedding/              EmbeddingClient (OpenAI, Voyage)
│   ├── memory/session/         SessionService backed by Memory or Redis
│   ├── observability/          OTel bootstrap, gen_ai.* semconv, AgentLogEvent
│   ├── tools/                  ToolRegistryService (self-registration via OnModuleInit)
│   ├── prompts/                BasePromptBuilder + tool-formatter
│   └── openai/                 OpenAI request/response zod schema + builders
│
├── tools/
│   ├── vector-search/          Qdrant-backed vector_search tool
│   ├── knowledge-base-stats/   get_knowledge_base_stats tool
│   └── fetch-url/              fetch_url tool
│
├── config/configuration.ts     Single nested ConfigFactory
└── e2e/                        supertest smoke against the HTTP stack
```

### Request flow (`POST /v1/chat/completions`)

```
client → KeycloakAuthGuard → RbacGuard → RateLimitInterceptor → WebController
                                                                    │
                                                                    ▼
                                                              WebService
                                                                    │
                                                                    ▼
                                                          RagAgentService
                                                                    │
                                  ┌───────────────┬─────────────────┴─────────┐
                                  ▼               ▼                           ▼
                          QueryRewrite    RetrievalService              SessionService
                                            (vector_search)                   │
                                                  │                           │
                                                  ▼                           │
                                            QdrantService                     │
                                                                              ▼
                                          PromptAssemblerService ← chat history
                                                  │
                                                  ▼
                                            LlmRegistryService
                                                  │
                          ┌───────────┬───────────┼───────────┬───────────┐
                          ▼           ▼           ▼           ▼           ▼
                      Anthropic    OpenAI      Gemini       Ollama   (fallback)
                                                                              │
                                                                              ▼
                                                                ResponseRecorderService
                                                                  (session + AgentLogEvent)
```

If `vector_search` is unavailable (tool not registered, or denied by RBAC), the agent returns a fixed fallback message instead of calling the LLM.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness — `{"status":"ok"}` |
| `GET` | `/v1/models` | Lists exactly one entry per registered agent (today: `rag-agent`) |
| `POST` | `/v1/chat/completions` | OpenAI-shaped chat endpoint; supports `stream: true` over SSE |

The chat endpoint accepts an optional `x-session-id` header to resume a conversation. If omitted, a new session id is generated and returned in the response header.

When `stream: true`, the response is `text/event-stream` with `data: <chunk>\n\n` frames terminated by `data: [DONE]\n\n` for OpenAI / OpenWebUI compatibility.

---

## Entrypoints

### HTTP (production)

```bash
pnpm build         # nest build (SWC) → dist/
pnpm start         # node dist/main.js (reads ../../.env)
pnpm start:dev     # nest start --watch
```

### CLI (one-shot)

```bash
pnpm build && pnpm start:cli "How do I configure the VPN?"
```

Loads the same DI container as the HTTP server (sans HTTP listener) and runs a single `RagAgentService.processMessage`.

### MCP stdio

```bash
pnpm build && pnpm mcp-server
```

Boots a minimal Nest context exposing the ToolRegistryService over the Model Context Protocol. Any MCP client (Claude Desktop, custom clients) can list and invoke `vector_search`, `get_knowledge_base_stats` and `fetch_url`.

Quick smoke:

```bash
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
  sleep 1
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
) | node dist/entry-points/mcp/mcp.bootstrap.js
```

---

## Tools

| Tool | Description |
|------|-------------|
| `vector_search` | Semantic search over Qdrant; returns the top chunks plus their source URLs |
| `get_knowledge_base_stats` | Returns the indexed chunk count for the collection |
| `fetch_url` | Fetches the body of any HTTP(S) URL (max ~4000 chars) |

Tools self-register at startup via `OnModuleInit`. New tools are added by writing a `@Injectable()` class implementing `Tool`, then importing its module from `AppModule` (or `McpAppModule`).

---

## Authentication

### Dev mode (no Keycloak)

When `KEYCLOAK_JWKS_URL` is unset:

- If `AGENT_API_KEY` is set, requests must carry `Authorization: Bearer <key>`.
- Otherwise all requests are accepted (local development only).

### Keycloak mode

When `KEYCLOAK_JWKS_URL` is set, every request must carry a valid JWT verified against the JWKS endpoint. The `realm_access.roles` claim is read for RBAC.

---

## Role-based tool access

`ROLE_TOOL_CONFIG` is a JSON object mapping role names to allowed tool name arrays:

```env
ROLE_TOOL_CONFIG={"admin":["vector_search","fetch_url","get_knowledge_base_stats"],"user":["vector_search","get_knowledge_base_stats"]}
```

Role resolution priority:

1. `X-Role` request header (honoured even in Keycloak mode for dev/test)
2. JWT `realm_access.roles[0]` claim (Keycloak mode only)
3. Literal `"default"`

If a role is not present in the config and no `"default"` entry exists, the role is denied all tools — the agent then falls back to "I don't know" because `vector_search` is unavailable.

---

## Session management

Conversations are keyed by `x-session-id`. The default backend is in-process; set `SESSION_STORE_TYPE=redis` and `REDIS_URL` to share state across replicas. Sessions are evicted after `SESSION_TTL_MS` (default 30 min) of inactivity.

---

## Rate limiting

`POST /v1/chat/completions` is protected by a per-IP token-bucket interceptor.

| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_RPM` | `60` | Steady-state requests per minute |
| `RATE_LIMIT_BURST` | `10` | Bucket capacity (burst on top of the rate) |

Over-limit requests return HTTP 429 with a `Retry-After` header (seconds).

---

## Observability

The service emits **two parallel telemetry streams**:

### 1. OpenTelemetry traces

`tracing-init.ts` starts a `NodeSDK` with `OTLPTraceExporter` before Nest loads, so HTTP / Express / undici are auto-instrumented. The agent adds three nested spans per request, all using the OTel GenAI semantic conventions:

- `agent.run` — `agent.name`, `agent.session_id`
- `gen_ai.chat` (one per LLM call) — `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`
- `gen_ai.tool.execute` (one per tool call) — `gen_ai.tool.name`, `tool.success`; for `vector_search` also `db.system=qdrant`, `db.collection.name`, `gen_ai.retrieval.result_count`

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` to forward to the Jaeger all-in-one container shipped in `docker-compose.yml`. UI: http://localhost:16686.

### 2. Structured AgentLogEvent JSON lines

`ResponseRecorderService` emits a JSON line for every request, with `type: "request" | "retrieval" | "llm-call" | "tool-call"`. These are written through Winston so they end up on stdout (Docker → log driver of choice).

### Audit content (opt-in)

Span attributes contain durations, token counts and model identifiers but **not the actual prompts or completions**. To capture user / assistant messages and tool inputs / outputs as span events (for offline audit), set:

```env
OTEL_GENAI_CAPTURE_CONTENT=true
```

This emits `gen_ai.user.message`, `gen_ai.assistant.message`, `tool.input` and `tool.output` events on the relevant spans. Treat the OTel backend as PII-sensitive when this flag is on.

---

## Environment variables

### Process

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8001` | HTTP listen port |
| `LOG_LEVEL` | `info` | Winston log level (`error` / `warn` / `info` / `debug`) |
| `SERVICE_NAME` | `fredy-agent` | OTel resource `service.name` |
| `PROJECT_ENV` | `development` | OTel resource `deployment.environment.name` |

### LLM providers (at least one key required at runtime)

| Variable | Default | Purpose |
|---|---|---|
| `LLM_FALLBACK_MODEL` | `claude-sonnet-4-5-20250929` | Model picked when the client omits one |
| `ANTHROPIC_API_KEY` | — | Enables the Anthropic client |
| `ANTHROPIC_MAX_TOKENS` | `4096` | Max output tokens |
| `OPENAI_API_KEY` | — | Enables the OpenAI client |
| `OPENAI_BASE_URL` | — | Optional custom base URL (Azure OpenAI etc.) |
| `OPENAI_MAX_TOKENS` | `4096` | Max output tokens |
| `GEMINI_API_KEY` | — | Enables the Gemini client |
| `GEMINI_MAX_TOKENS` | `4096` | Max output tokens |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | `llama3.2` | Default Ollama model |
| `OLLAMA_MODELS` | — | Comma-separated allowlist of Ollama models the registry should claim |

### Embedding (used by `vector_search`)

| Variable | Default | Purpose |
|---|---|---|
| `EMBEDDING_PROVIDER` | `openai` | `openai` or `voyage` |
| `EMBEDDING_OPENAI_API_KEY` *(fallback: `EMBEDDING_API_KEY`)* | — | Required if provider is `openai` |
| `EMBEDDING_OPENAI_MODEL` *(fallback: `EMBEDDING_MODEL`)* | `text-embedding-3-small` | OpenAI embedding model |
| `EMBEDDING_VOYAGE_API_KEY` | — | Required if provider is `voyage` |
| `EMBEDDING_VOYAGE_MODEL` | `voyage-3-lite` | Voyage embedding model |

### Vector store (Qdrant)

| Variable | Default | Purpose |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant base URL |
| `QDRANT_COLLECTION` | `confluence-pages` | Collection to query |

### Retrieval / prompt budget

| Variable | Default | Purpose |
|---|---|---|
| `RAG_DEFAULT_RETRIEVAL_LIMIT` | `5` | Max chunks per query |
| `RAG_SCORE_THRESHOLD` | `0.7` | Min cosine similarity for a chunk to qualify |
| `RAG_TOKEN_BUDGET` | `3200` | Hard cap on context tokens passed to the LLM |

### Session

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_STORE_TYPE` | `memory` | `memory` or `redis` |
| `REDIS_URL` | `redis://localhost:6379` | Required when `SESSION_STORE_TYPE=redis` |
| `SESSION_TTL_MS` | `1800000` | Session inactivity TTL (30 min) |

### Auth

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_API_KEY` | — | Static bearer accepted in dev mode |
| `KEYCLOAK_JWKS_URL` | — | When set, switches to JWT verification |
| `KEYCLOAK_ISSUER` | — | Expected `iss` claim |
| `KEYCLOAK_AUDIENCE` | `fredy-agent` | Expected `aud` claim |
| `ROLE_TOOL_CONFIG` | — | JSON role → tool allowlist (see above) |

### Rate limit

| Variable | Default | Purpose |
|---|---|---|
| `RATE_LIMIT_RPM` | `60` | Steady-state limit |
| `RATE_LIMIT_BURST` | `10` | Bucket capacity |

### Observability

| Variable | Default | Purpose |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP-HTTP collector URL (no trailing `/v1/traces`) |
| `OTEL_GENAI_CAPTURE_CONTENT` | `false` | Set to `true` to emit prompt / completion content as span events |

---

## Development

```bash
pnpm install
pnpm build           # nest build (SWC)
pnpm test            # Jest unit tests
pnpm test:cov        # Jest with coverage
pnpm test:e2e        # supertest e2e (boots the full HTTP stack with stubs)
pnpm lint
pnpm format
```

Tests are co-located with the source as `*.spec.ts`. The e2e suite under `src/e2e/` overrides `LLM_CLIENTS` and replaces the registered `vector_search` tool to keep the run self-contained.

---

## Known limitations

- The `QueryRewriteService` uses simple punctuation-based expansion. An LLM-driven rewrite (a separate provider call before retrieval) is out of scope for the current architecture but plugs in cleanly under the same interface.
- Mistral is intentionally not yet wired into the registry. Adding it means a new `shared/llm/mistral/` directory implementing `LlmClient` plus an entry in `LlmModule`'s factory.
- The `fetch_url` tool truncates large pages to ~4000 characters and does not strip HTML. Use it for short content; for long documents, ingest them into Qdrant via `services/confluence-importer` instead.
