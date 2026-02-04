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

## Security Note

Move API keys from docker-compose.yml to environment variables or a secrets manager before deploying.
