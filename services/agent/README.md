# Fredy Agent Service

Slim TypeScript service (Fastify + LangGraph.js) exposing a deterministic RAG agent over an OpenAI-compatible HTTP API. The agent grounds every answer in Confluence content retrieved from PostgreSQL via pgvector — there is no open-ended ReAct loop. Answers without retrieval context are refused.

The service is built on the shared **`@fredy/agent-core`** package (`packages/agent-core`), which every future agent reuses.

## Architecture

```
packages/agent-core/            Framework-agnostic base for all agents
├── logging/                    pino logger factory (JSON in prod, pretty in dev)
├── otel/                       Tracing bootstrap, gen_ai.* semconv,
│                               LangChain→OTel callback handler
├── llm/                        resolveChatModel: model id → LangChain ChatModel
│                               (claude-* → Anthropic, gpt-*/o1/o3/o4* → OpenAI,
│                                gemini-* → Google GenAI, else fallback model)
├── tools/                      ToolRegistry + RBAC allowlist filtering
├── agents/                     AgentDefinition / AgentRun / AgentRegistry
└── config/                     defineConfig: zod-based fail-fast env validation

services/agent/src/
├── main.ts                     Bootstrap: OTel first, config, pool, tools, agents
├── server.ts                   Fastify app factory (used by e2e tests too)
├── config.ts                   Full env schema (fail-fast at boot)
├── profile.ts                  RAG_PROFILE resolution from the rag_profiles table
├── plugins/
│   ├── auth.ts                 API key or Keycloak JWT (jose + remote JWKS)
│   ├── rbac.ts                 Role resolution → request.allowedToolNames
│   └── rate-limit.ts           Token bucket per client IP (with eviction)
├── routes/
│   ├── health.ts               GET /health
│   ├── models.ts               GET /v1/models (one entry per registered agent)
│   └── chat-completions.ts     POST /v1/chat/completions (JSON + SSE)
├── agents/rag-agent/
│   ├── rag-agent.ts            AgentDefinition wiring the graph + OTel spans
│   ├── graph.ts                LangGraph: retrieve → (generate | refuse)
│   ├── retrieval.ts            Query expansion, vector_search, optional rerank
│   ├── query-split.ts          Heuristic expansion (≤5 queries)
│   └── system-prompt.ts        Grounding prompt + verbatim refusal text
├── tools/                      LangChain tools: vector_search,
│                               embeddings client, pgvector store
└── rerank/                     Cohere /v2/rerank and Voyage /v1/rerank clients
```

### The RAG graph

The pipeline is a LangGraph `StateGraph`, so each stage is swappable without touching the HTTP layer:

1. **retrieve** — expands the user message into up to 5 queries, runs `vector_search` per query (top-k, score threshold), pools the hits. When `RERANKER` is enabled the pooled chunks are re-scored via Cohere/Voyage and the context is rebuilt from the top `RERANK_TOP_N` above `RERANK_THRESHOLD`. Unavailable/denied tool or zero hits → `null` context.
2. **generate** — system prompt + retrieved context (trimmed to `RAG_TOKEN_BUDGET`), followed by the request history (client system messages are dropped). Streams tokens via `streamEvents`.
3. **refuse** — conditional branch when the context is `null`; returns a fixed refusal instead of hallucinating.

### Adding another agent on the base

1. Implement `AgentDefinition<TDeps>` from `@fredy/agent-core` (`id`, `ownedBy`, `createRun(deps)`), returning an `AgentRun` with `invoke()` and `stream()`.
2. Register it in `main.ts`: `agentRegistry.register(createMyAgent(), deps)`.
3. Done — it appears in `GET /v1/models` and is addressable via the `model` field of `POST /v1/chat/completions`. Logging, RBAC, rate limiting and OTel come from the shared base.

## HTTP API (OpenAI-compatible)

| Route | Description |
|---|---|
| `GET /health` | Liveness probe, bypasses auth |
| `GET /v1/models` | Lists registered agents as models |
| `POST /v1/chat/completions` | Chat completion; `stream: true` for SSE. `model` selects the agent (default: first registered). `temperature`/`max_tokens` are forwarded to the LLM. Responses include `usage`. The `x-session-id` header is echoed (or generated) for trace correlation. |

## Configuration

All variables are validated at boot; invalid values crash the service immediately.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8001` | HTTP port |
| `LOG_LEVEL` | `info` | pino log level |
| `LLM_FALLBACK_MODEL` | `claude-sonnet-4-5-20250929` | Model used by the RAG agent (and fallback for unknown ids) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | – | Provider credentials |
| `ANTHROPIC_MAX_TOKENS` / `OPENAI_MAX_TOKENS` / `GEMINI_MAX_TOKENS` | `4096` | Max output tokens per provider |
| `OPENAI_BASE_URL` | – | Custom OpenAI-compatible endpoint |
| `EMBEDDING_PROVIDER` | `openai` | `openai` or `voyage` |
| `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` | – | Shared fallbacks for both providers |
| `EMBEDDING_OPENAI_API_KEY` / `EMBEDDING_OPENAI_MODEL` / `EMBEDDING_OPENAI_ENDPOINT` | model `text-embedding-3-small` | OpenAI embeddings |
| `EMBEDDING_VOYAGE_API_KEY` / `EMBEDDING_VOYAGE_MODEL` / `EMBEDDING_VOYAGE_ENDPOINT` | model `voyage-3-lite` | Voyage embeddings (`input_type: query`) |
| `DATABASE_URL` | `postgresql://fredy:fredy@localhost:5432/fredy` | PostgreSQL/pgvector |
| `CHUNKS_TABLE` | `chunks` | Chunk table (env fallback when no profile) |
| `RAG_PROFILE` | – | Profile name in the importer's `rag_profiles` registry; when set, table + embedding provider/model come from that row (env is the fallback) |
| `RAG_DEFAULT_RETRIEVAL_LIMIT` | `5` | Top-k per retrieval query |
| `RAG_SCORE_THRESHOLD` | `0.7` | Cosine similarity cutoff |
| `RAG_TOKEN_BUDGET` | `3200` | Context budget (~4 chars/token) |
| `RERANKER` | `none` | `none`, `cohere` or `voyage` (mirrors the eval harness) |
| `RERANK_API_KEY` | – | Required when `RERANKER` != none |
| `RERANK_MODEL` | `rerank-v3.5` (cohere) / `rerank-2.5` (voyage) | Rerank model |
| `RERANK_TOP_N` | `10` | Candidates kept after reranking |
| `RERANK_THRESHOLD` | `0.0` | Minimum relevance score |
| `AGENT_API_KEY` | – | Static bearer key (only when Keycloak is off) |
| `KEYCLOAK_JWKS_URL` / `KEYCLOAK_ISSUER` / `KEYCLOAK_AUDIENCE` | audience `fredy-agent` | JWT verification; enabling JWKS switches auth to Keycloak mode |
| `ROLE_TOOL_CONFIG` | – | JSON `{role: [tool, ...]}` allowlist; malformed config crashes at boot |
| `RATE_LIMIT_RPM` / `RATE_LIMIT_BURST` | `60` / `10` | Token bucket per client IP |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | – | OTLP/HTTP trace exporter (spans stay local when unset) |
| `OTEL_GENAI_CAPTURE_CONTENT` | `false` | Opt-in prompt/response capture in spans |
| `SERVICE_NAME` / `PROJECT_ENV` / `SERVICE_VERSION` | `fredy-agent` / `development` / `0.1.0` | Resource attributes for logs and traces |

## Development

```bash
pnpm --filter @fredy/agent-core build   # build the base first
pnpm --filter @fredy/agent build
pnpm --filter @fredy/agent test         # vitest with v8 coverage (lcov)
pnpm --filter @fredy/agent lint
```

## Dropped features (vs. the previous NestJS service)

- **Server-side session memory** — Open-WebUI sends the full conversation history with every request, so per-session state added complexity without benefit. The `x-session-id` header is kept purely for trace/log correlation.
- **MCP stdio entry point** — unused; the tool registry is now consumed directly by the agent graph. An MCP server can be reintroduced as a separate thin entry point on top of `ToolRegistry` if needed.
- **Hand-written LLM provider clients** — replaced by LangChain chat models (`@langchain/anthropic`, `@langchain/openai`, `@langchain/google-genai`) resolved through `agent-core`'s `resolveChatModel`.
- **`fetch_url` and `get_knowledge_base_stats` tools** — registered but never invoked: the deterministic RAG graph only calls `vector_search`, so they were dead code with real maintenance surface (SSRF hardening). Restore them from git history once an agent actually dispatches tools (e.g. a ReAct loop or an MCP entry point).
