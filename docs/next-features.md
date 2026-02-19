# Fredy — Next Feature Roadmap

This document describes planned features for the Fredy AI Agent platform. Features are grouped by theme and ordered roughly by implementation value vs. effort.

---

## Agent Service

### Ollama LLM Backend

**What:** Add Ollama as a second LLM provider so the agent can run fully locally without any API costs.

**Why:** The `LLMClient` interface is already provider-agnostic. Ollama exposes an OpenAI-compatible API, so an `OllamaClient` implementation would be a thin wrapper. This makes local development free and removes the need for API keys during testing.

**Scope:** New file `services/agent/src/llm/ollama.ts` + factory update in `services/agent/src/llm/index.ts`. No architectural changes needed.

---

### Conversation History Persistence

**What:** Persist session history (the in-memory `Map<string, Message[]>` in `server.ts`) to an external store (Redis or SQLite) so conversations survive service restarts.

**Why:** Currently all sessions are lost on restart. For a real IT operations agent used across the day, this is a usability blocker.

**Scope:** Abstract the session store behind an interface. Provide an in-memory implementation (current behaviour) and a Redis implementation. Configurable via `SESSION_STORE=redis|memory`.

---

### Rate Limiting on the HTTP Server

**What:** Add per-client rate limiting to the `/v1/chat/completions` endpoint to prevent abuse and accidental runaway loops.

**Why:** Without rate limiting, a misconfigured client or a looping agent consumer could exhaust API quotas or overload the service.

**Scope:** Hono has middleware for this (`hono/rate-limiter` or a lightweight custom implementation). Configurable via env vars (`RATE_LIMIT_RPM`, `RATE_LIMIT_BURST`).

---

### Complete the MCP Server

**What:** The `services/agent/src/mcp-server/` directory is currently a skeleton. Implement it as a fully functional MCP server that exposes the agent's tools (knowledge base search, any registered tools) as MCP resources and tools.

**Why:** This would allow Open-WebUI, Claude Desktop, and other MCP-compatible clients to connect directly to Fredy's tools without going through the OpenAI-compatible HTTP layer.

**Scope:** Implement tool handlers using the `@modelcontextprotocol/sdk` that is already installed. Wire existing `ToolRegistry` into MCP tool definitions.

---

## RAG Pipeline

### Cohere Embeddings

**What:** Implement the Cohere embedding provider. The `EmbeddingClient` interface is already defined and the `voyage.ts` implementation serves as a reference.

**Why:** Cohere's `embed-multilingual-v3` model is strong for multilingual IT documentation and is cheaper than OpenAI embeddings at scale.

**Scope:** New file `services/rag/src/embeddings/cohere.ts` + registration in `services/rag/src/embeddings/index.ts`. The `TODO` comment in `embeddings/index.ts` already marks this gap.

---

### Jira as a Knowledge Source

**What:** Add a Jira issue ingestion pipeline alongside the existing Confluence pipeline. Fetch issues (epics, stories, bugs) from configured projects, convert them to chunks, and store them in Qdrant.

**Why:** IT operations knowledge lives in both Confluence (runbooks, docs) and Jira (incident history, known issues). Combining both gives the agent much richer context for answering "has this happened before?" type questions.

**Scope:** New `services/rag/src/jira/` module mirroring the `confluence/` structure. Reuses existing chunking and embedding pipeline.

---

### GitHub as a Knowledge Source

**What:** Ingest GitHub repository content — READMEs, wikis, issues, and pull request discussions — into the RAG pipeline.

**Why:** For IT/DevOps agents, infrastructure-as-code repositories and their associated issues are a key knowledge source.

**Scope:** New `services/rag/src/github/` module. GitHub's REST API is simpler than Confluence's, so this is a smaller implementation effort than Jira.

---

### Confluence Webhook for Real-Time Sync

**What:** Replace the polling-based sync (`cron.ts`) with a Confluence webhook that triggers an incremental sync whenever a page is created, updated, or deleted.

**Why:** The current scheduler runs every 6 hours by default, meaning the knowledge base can be up to 6 hours stale. Webhooks make sync near-instant.

**Scope:** Add a webhook receiver endpoint to the RAG service (or agent HTTP server). Register the webhook with Confluence on startup. Requires an inbound network path from Confluence to the service (i.e., works for cloud-hosted Confluence, needs a tunnel for local dev).

---

### RAG Evaluation Pipeline

**What:** A set of test queries with known expected answers used to measure retrieval quality (recall, MRR, NDCG) after any change to chunking strategy, embedding model, or collection config.

**Why:** It's currently impossible to know if a change to chunk size, overlap, or embedding model improves or degrades retrieval quality. An evaluation dataset makes this measurable.

**Scope:** A script `services/rag/src/eval/` that runs a query set, compares retrieved chunks against expected sources, and outputs a quality score. Golden dataset stored in `data/eval/`.

---

## Observability

### OpenTelemetry Tracing

**What:** Instrument both services with OpenTelemetry traces (spans for LLM calls, tool executions, RAG retrievals, embedding calls).

**Why:** When the agent gives a wrong answer or is slow, there is currently no way to trace _why_ — which tool was called, how long the embedding took, what the RAG query returned. Traces make this debuggable.

**Scope:** Add `@opentelemetry/sdk-node` + relevant instrumentations. Export to a local Jaeger or OTLP-compatible collector (add to `docker-compose.yml`). Keep it opt-in via `OTEL_ENABLED=true`.

---

## Infrastructure

### Secrets Management

**What:** Move all API keys and credentials from `docker-compose.yml` env vars into a secrets manager (Docker secrets, HashiCorp Vault, or at minimum a `.env` file that is never committed).

**Why:** The `CLAUDE.md` already flags this as a security requirement. `.env` values are currently referenced inline in `docker-compose.yml`, which risks accidental exposure in logs or commits.

**Scope:** Create `.env.example` (template without values), update `docker-compose.yml` to use `env_file: .env`, add `.env` to `.gitignore` (verify it is already excluded).

---

## Multi-Agent Orchestration (Future)

**What:** Route different types of queries to specialized agents (e.g., a "documentation agent" that searches Confluence/Jira, a "deployment agent" with access to CI/CD tools, a "monitoring agent" with access to metrics).

**Why:** A single agent with access to all tools becomes hard to reason about and token-heavy. Specialised agents with narrow tool sets are more accurate and cheaper.

**Scope:** Requires an orchestrator layer that classifies intent and delegates to sub-agents. This is the largest architectural change on this list and builds on all other features above being stable first.
