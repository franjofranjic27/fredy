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

Monorepo containing multiple services, designed for potential future splitting:

```
/services          # Individual services (agents, MCP servers)
/packages          # Shared libraries and utilities
/infrastructure    # Docker, deployment configs
/prompts           # LLM implementation guides and prompts
```

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
| Open-WebUI | http://localhost:3000 | Web interface |
| PostgreSQL / pgvector | localhost:5432 | Vector database |
| Keycloak | http://localhost:8080 | OAuth provider |

## Architecture

### Infrastructure Layer
- **Open-WebUI**: Chat interface connected to the agent and vector DB
- **PostgreSQL + pgvector**: Vector database for embeddings and semantic search (shared by the Fredy RAG pipeline and Open-WebUI)
- **Keycloak**: OAuth/OIDC provider for Open-WebUI and the agent

### Application Layer (planned)
- **AI Agents**: Orchestration logic using Claude API
- **MCP Servers**: Tool providers for Confluence, REST APIs, and other integrations
- **RAG Pipeline**: Document ingestion, chunking, embedding, and retrieval

## Design Principles

- Provider-agnostic LLM integration (start with Claude, extensible to others)
- Loosely coupled services for future repository splitting
- PostgreSQL + pgvector as the single vector store for both the RAG pipeline and Open-WebUI

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
- `confluence-importer` — Confluence → pgvector ingestion service (`services/confluence-importer/`)
- `agent` — AI agent service (`services/agent/`)
- `mcp` — MCP servers (`services/mcp-*`)
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
feat(confluence-importer): add local file ingestion source

Support .md/.txt/.html files from a mounted directory alongside
Confluence as a source. Reuses existing chunking pipeline by
converting local files to HTML first.
```
```
fix(agent): handle empty API response in tool executor
```
```
chore(infra): add confluence-importer service to docker-compose stack
```

## Security Note

Move API keys from docker-compose.yml to environment variables or a secrets manager before deploying.
