# Fredy — Next Feature Roadmap

This document describes planned features for the Fredy AI Agent platform. Features are grouped by theme and ordered roughly by implementation value vs. effort.

---

## Agent Service

### Complete the MCP Server

**What:** The `services/agent/src/mcp-server/` directory is currently a skeleton. Implement it as a fully functional MCP server that exposes the agent's tools (knowledge base search, any registered tools) as MCP resources and tools.

**Why:** This would allow Open-WebUI, Claude Desktop, and other MCP-compatible clients to connect directly to Fredy's tools without going through the OpenAI-compatible HTTP layer.

**Scope:** Implement tool handlers using the `@modelcontextprotocol/sdk` that is already installed. Wire existing `ToolRegistry` into MCP tool definitions.

---

## RAG Pipeline

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

## Multi-Agent Orchestration (Future)

**What:** Route different types of queries to specialized agents (e.g., a "documentation agent" that searches Confluence/Jira, a "deployment agent" with access to CI/CD tools, a "monitoring agent" with access to metrics).

**Why:** A single agent with access to all tools becomes hard to reason about and token-heavy. Specialised agents with narrow tool sets are more accurate and cheaper.

**Scope:** Requires an orchestrator layer that classifies intent and delegates to sub-agents. This is the largest architectural change on this list and builds on all other features above being stable first.
