# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fredy is an AI Agent platform for exploring and implementing generative AI best practices. The project serves as both a learning environment and a production-ready portfolio demonstrating:

- **MCP Servers**: Building Model Context Protocol servers for tool integrations
- **RAG Systems**: Retrieval-Augmented Generation with vector databases
- **AI Agents**: Autonomous agents using LLM providers (starting with Claude)
- **Client Integration**: Using Open-WebUI as the user interface

### First Use Case: IT Operations Agent

An intelligent agent with access to organizational knowledge (Confluence, documentation) via RAG and external systems via MCP servers for REST API integrations.

## Repository Structure

Monorepo containing agents, shared libraries, and infrastructure services:

```
/agents            # Agent implementations (each is a standalone pnpm package)
  /react           # @fredy/agent-react — ReAct IT Ops agent (HTTP + MCP server)
  /rag             # @fredy/agent-rag   — RAG-focused agent (placeholder)

/shared            # Cross-agent shared libraries (pnpm packages)
  /llm             # @fredy/llm         — LLM clients (Claude, Ollama) + types
  /memory          # @fredy/memory      — Session/conversation memory (in-memory, Redis)
  /tools           # @fredy/tools       — Tool interface, ToolRegistry base
  /observability   # @fredy/observability — Logger + OpenTelemetry tracing

/services          # Infrastructure services (not agents)
  /rag             # @fredy/rag         — RAG ingestion pipeline (Confluence, local files)

/infrastructure    # Docker, deployment configs
/docs              # Architecture docs and migration plans
/config            # LiteLLM and other service configs
```

### Adding a New Agent

1. Create `agents/<name>/` with `package.json`, `tsconfig.json`, `src/`
2. Add shared deps: `@fredy/llm`, `@fredy/memory`, `@fredy/tools`, `@fredy/observability`
3. Implement your agent loop in `src/agent.ts`
4. The pnpm workspace picks it up automatically (`agents/*` glob)

**Languages & Build Tools:**
- TypeScript projects: pnpm
- Python projects: poetry

## Development Commands

### Docker Services

```bash
docker compose up -d          # Start all services
docker compose down           # Stop all services
docker compose logs -f        # View logs
docker compose restart <svc>  # Restart specific service
```

### Service Endpoints

| Service | URL | Purpose |
|---------|-----|---------|
| Ollama | http://localhost:11434 | Local LLM runtime |
| Open-WebUI | http://localhost:3000 | Web interface |
| Qdrant | http://localhost:6333 | Vector database |

## Architecture

### Infrastructure Layer
- **Ollama**: Local LLM inference for development and cost-effective usage
- **Open-WebUI**: Chat interface connected to LLM providers and vector DB
- **Qdrant**: Primary vector database for embeddings and semantic search
- **pgvector**: Alternative vector storage option (PostgreSQL extension)

### Application Layer (planned)
- **AI Agents**: Orchestration logic using Claude API
- **MCP Servers**: Tool providers for Confluence, REST APIs, and other integrations
- **RAG Pipeline**: Document ingestion, chunking, embedding, and retrieval

## Design Principles

- Provider-agnostic LLM integration (start with Claude, extensible to others)
- Loosely coupled services for future repository splitting
- Both Qdrant and pgvector support for comparing vector DB approaches

## Implementation Guides

- `prompts/agent-setup.md`: Step-by-step guide for building the agent system (Phase 1: Client + Claude, Phase 2: TypeScript agent with MCP tools)

## Commit Convention

All commits in this repository MUST follow this format:

```
<type>(<scope>): <short summary>

<optional body — what and why, not how>
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `ci`, `build`

**Scopes** (use the most specific one that applies):
- `rag` — RAG ingestion service (`services/rag/`)
- `agent` — ReAct agent (`agents/react/`) or cross-agent changes
- `mcp` — MCP servers (`services/mcp-*`)
- `llm` — LLM shared package (`shared/llm/`)
- `memory` — Memory shared package (`shared/memory/`)
- `tools` — Tools shared package (`shared/tools/`)
- `observability` — Observability shared package (`shared/observability/`)
- `infra` — Docker, docker-compose, deployment configs
- `config` — Environment, build, or project-level config
- Omit scope for cross-cutting changes

**Rules:**
- Subject line: imperative mood, lowercase, no period, max 72 chars
- Body: wrap at 72 chars, explain *why* not *what* (the diff shows *what*)
- One logical change per commit — don't bundle unrelated changes
- Reference issues with `Closes #N` or `Refs #N` in the body when applicable

**Examples:**
```
feat(rag): add local file ingestion source

Support .md/.txt/.html files from a mounted directory alongside
Confluence as a RAG source. Reuses existing chunking pipeline by
converting local files to HTML first.
```
```
fix(agent): handle empty API response in tool executor
```
```
chore(infra): add rag service to docker-compose stack
```

## Security Note

Move API keys from docker-compose.yml to environment variables or a secrets manager before deploying.
