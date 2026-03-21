# Fredy Agent Service

An autonomous AI agent exposing an OpenAI-compatible HTTP API. Open-WebUI (or any OpenAI client)
sends chat messages to the agent; the agent calls tools in a loop until it has a final answer.

## Architecture

```
Client (Open-WebUI / curl)
        │ POST /v1/chat/completions
        ▼
  ┌─────────────┐     Auth middleware       ┌──────────────┐
  │  Hono HTTP  │ ─── (API key / JWT) ────► │ Rate limiter │
  │   server    │                           └──────┬───────┘
  └──────┬──────┘                                  │
         │ runAgent()                               │
         ▼                                          ▼
  ┌─────────────────────────────────────────────────────┐
  │                   Agent loop                        │
  │                                                     │
  │  messages ──► LLM ──► tool_use? ──► execute tools  │
  │                 ▲                         │         │
  │                 └─────── tool results ────┘         │
  │                                                     │
  │  Repeat up to maxIterations (default: 10)           │
  └──────────────────────┬──────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │    LLM providers    │
              ├─────────────────────┤
              │ Claude (default)    │
              │ Ollama (local)      │
              └─────────────────────┘
```

The agent loop (`agent.ts`):

1. **LLM call** — sends the full message history (system prompt + conversation + tool results) to the LLM
2. **Tool calls** — if the LLM responds with `tool_use`, all tool calls are executed in parallel
3. **Tool results** — appended to the message history as a user message
4. **Repeat** — until the LLM produces a plain text response or `maxIterations` is hit

---

## Entrypoints

### HTTP server (Open-WebUI integration)

Exposes an OpenAI-compatible API on port `8001`. This is what Open-WebUI connects to.

```bash
pnpm dev:server          # development (hot-reload, reads ../../.env)
pnpm start:server        # production (compiled dist/)
```

Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check — returns `{"status":"ok"}` |
| `GET` | `/v1/models` | Lists the available model (`fredy-it-agent`) |
| `POST` | `/v1/chat/completions` | Main chat endpoint — supports streaming and non-streaming |

The chat endpoint accepts a `x-session-id` header to resume a conversation. If omitted, a new
session is created and the ID is returned in the response header.

### CLI (single query)

Runs one query and prints the result to stdout. Useful for smoke-testing.

```bash
pnpm dev                          # "What time is it and what is 42 * 17?"
pnpm dev "How do I reset a VPN?"  # custom query
```

### MCP server (stdio)

Exposes the same tool registry as an MCP server over stdio. Any MCP-compatible client
(e.g. Claude Desktop) can use this to call the agent's tools directly.

```bash
pnpm mcp-server           # development
pnpm mcp-server:prod      # production (compiled dist/)
```

---

## Tools

| Tool | Description |
|------|-------------|
| `search_knowledge_base` | Semantic search over Qdrant (requires `EMBEDDING_API_KEY`) |
| `get_knowledge_base_stats` | Returns chunk count and space breakdown from Qdrant |
| `fetch_url` | Fetches the body of any HTTP/HTTPS URL |
| `get_current_time` | Returns the current date/time for a given timezone |
| `calculator` | Evaluates arithmetic expressions (`+`, `-`, `*`, `/`) |

`search_knowledge_base` is only registered when `EMBEDDING_API_KEY` is set.

---

## Authentication

### Dev mode (no Keycloak)

When `KEYCLOAK_JWKS_URL` is not set, the server falls back to a static API key:

- If `AGENT_API_KEY` is set, every request must include `Authorization: Bearer <key>`
- If `AGENT_API_KEY` is also unset, all requests are accepted (local development only)

### Production mode (Keycloak JWT)

When `KEYCLOAK_JWKS_URL` is set, every request must carry a valid JWT:

```
Authorization: Bearer <jwt>
```

The JWT is verified against the JWKS endpoint. The `realm_access.roles` claim is read to determine
the caller's role (`admin` or `user`).

---

## Role-Based Tool Access (RBAC)

By default, all roles can call all tools. To restrict access, set `ROLE_TOOL_CONFIG` to a JSON
object mapping role names to allowed tool lists:

```env
ROLE_TOOL_CONFIG={"admin":["all"],"user":["search_knowledge_base","get_knowledge_base_stats"]}
```

Special value `"all"` grants access to every tool. Unknown roles fall back to the `"user"` entry;
if no `"user"` entry exists, all tools are allowed with a console warning.

Role resolution priority (highest first):

1. JWT `realm_access.roles` claim (signature-verified)
2. `x-openwebui-user-role` request header
3. `DEFAULT_ROLE` environment variable
4. Fallback: `"user"`

---

## Session Management

Conversation history is stored per `x-session-id`. Sessions expire after 30 minutes of inactivity.

The default backend is in-memory (single-process). `RedisSessionStore` is implemented in
`src/session/redis.ts` for multi-instance deployments but is not yet wired to an env var —
wire it up manually in `server.ts` when needed.

---

## Rate Limiting

Sliding-window rate limiting is applied to `POST /v1/chat/completions`, keyed by client IP
(`x-forwarded-for` → `x-real-ip` → `"unknown"`).

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_RPM` | `60` | Requests per minute |
| `RATE_LIMIT_BURST` | `10` | Extra burst allowance on top of RPM |

Requests over the limit receive a `429` response with a `Retry-After` header.

---

## Observability

OpenTelemetry tracing is off by default. Enable it with:

```env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # OTLP HTTP collector
```

Spans are emitted for each agent iteration (`agent.run`), LLM call (`llm.chat`), and tool
execution (`tool.execute`).

---

## Environment Variables

### LLM

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_PROVIDER` | No | `claude` | `claude` or `ollama` |
| `ANTHROPIC_API_KEY` | Yes* | — | Anthropic API key |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | No | `llama3.2` | Model name for Ollama |

*Required when `LLM_PROVIDER=claude` (the default).

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8001` | HTTP server port |
| `AGENT_API_KEY` | No | — | Static API key for dev auth |
| `VERBOSE` | No | `false` | Set to `true` for debug-level logging |

### Auth (Keycloak)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KEYCLOAK_JWKS_URL` | No | — | JWKS endpoint — enables JWT auth when set |
| `KEYCLOAK_ISSUER` | Yes* | — | Expected JWT issuer |
| `KEYCLOAK_AUDIENCE` | No | `fredy-agent` | Expected JWT audience |

*Required when `KEYCLOAK_JWKS_URL` is set.

### RBAC

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ROLE_TOOL_CONFIG` | No | — | JSON object mapping roles to allowed tool lists |
| `DEFAULT_ROLE` | No | `user` | Fallback role when none can be resolved |

### Knowledge base (RAG)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMBEDDING_API_KEY` | No | — | Enables `search_knowledge_base` when set |
| `EMBEDDING_PROVIDER` | No | `openai` | `openai` or `voyage` |
| `EMBEDDING_MODEL` | No | `text-embedding-3-small` | Embedding model name |
| `QDRANT_URL` | No | `http://localhost:6333` | Qdrant endpoint |
| `QDRANT_COLLECTION` | No | `confluence-pages` | Collection to search |

### Rate limiting

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_RPM` | No | `60` | Requests per minute per client IP |
| `RATE_LIMIT_BURST` | No | `10` | Burst allowance on top of RPM |

### Observability

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OTEL_ENABLED` | No | `false` | Set to `true` to enable OpenTelemetry tracing |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | `http://localhost:4318` | OTLP HTTP collector endpoint |

---

## Development

```bash
pnpm install
pnpm build          # tsc → dist/
pnpm test:run       # run tests once (vitest)
pnpm test           # watch mode
pnpm test:coverage  # coverage report → coverage/
pnpm lint           # eslint
pnpm format         # prettier
```

---

## Known Limitations

- **In-memory sessions only** — the `RedisSessionStore` is implemented but not yet configurable
  via environment variables. Horizontal scaling loses session history.
- **No retry on LLM errors** — a transient 5xx from Anthropic propagates immediately as a `502`.
- **Single system prompt** — the prompt is hard-coded in `setup.ts`; there is no per-request
  or per-role override mechanism.
- **Tool timeout is global** — each tool call has a 30-second hard timeout; there is no
  per-tool configuration.