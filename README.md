# 🐨 Fredy — OPS-AI Assistant

![fredy-logo.png](docs/assets/fredy-logo.png)

An AI Agent platform for exploring and implementing generative AI best practices — RAG pipelines, MCP servers, and autonomous agents backed by Claude.

## Services

| Service | URL | Description |
|---------|-----|-------------|
| Open-WebUI | http://localhost:3000 | Chat interface — talks to the Fredy agent |
| Fredy Agent | http://localhost:8001 | OpenAI-compatible RAG agent (single model: `rag-agent`) |
| PostgreSQL / pgvector | localhost:5432 | Vector database (Fredy RAG + Open-WebUI) |
| Confluence Importer | — | Background sync: Confluence / local files → pgvector |
| Keycloak | http://localhost:8080 | OAuth provider for Open-WebUI |
| Jaeger | http://localhost:16686 | OpenTelemetry trace viewer |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
- An [Anthropic API key](https://console.anthropic.com/)

## Quick Start

### 1. Create an `.env` file

```bash
cp .env.example .env   # or create it manually
```

Minimum required variable:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Start all services

```bash
docker compose up -d
```

### 3. Open the UI

Navigate to **http://localhost:3000** and start chatting. Open-WebUI is wired to the Fredy agent service, so the model dropdown lists exactly one entry:

| Model in UI | What it does |
|---|---|
| `rag-agent` | Deterministic RAG agent — every answer is grounded in Confluence content stored in PostgreSQL/pgvector. Picks its own LLM provider internally via `LLM_FALLBACK_MODEL`. |

New agents added under `services/agent/src/agents/` (e.g. a future `react-agent`) automatically show up here.

## Confluence Importer (optional)

The `confluence-importer` container syncs documents into PostgreSQL/pgvector so the agent can search them.

### Confluence ingestion

Add these variables to your `.env`:

```env
CONFLUENCE_BASE_URL=https://your-org.atlassian.net
CONFLUENCE_USERNAME=you@example.com
CONFLUENCE_API_TOKEN=your-token
CONFLUENCE_SPACES=ENG,OPS          # comma-separated space keys
EMBEDDING_PROVIDER=openai           # or voyage
EMBEDDING_API_KEY=sk-...
```

### Local file ingestion

Place `.md`, `.txt`, or `.html` files in `data/confluence-files/` and enable the feature:

```env
LOCAL_FILES_ENABLED=true
```

The importer syncs every 6 hours by default (`SYNC_CRON=0 */6 * * *`). To trigger a full sync on startup:

```env
SYNC_FULL_ON_START=true
```

## Common Commands

```bash
docker compose up -d              # Start all services in background
docker compose down               # Stop all services
docker compose logs -f confluence-importer  # Stream logs for the importer
docker compose restart openwebui  # Restart a single service
docker compose pull               # Pull latest images
```

## Releases

Docker images are published to Docker Hub (multi-arch: `linux/amd64` +
`linux/arm64`) and a GitHub release is cut per version. All requested images
build in parallel.

**One-time setup** (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
|------|------|-------|
| Variable | `DOCKERHUB_USERNAME` | your Docker Hub namespace (user or org) |
| Secret | `DOCKERHUB_TOKEN` | a Docker Hub access token with write scope |

Images (each tagged `0.0.1`, `0.0` and `latest`):

| Image | Source |
|-------|--------|
| `<user>/fredy-agent` | `services/agent/Dockerfile` |
| `<user>/fredy-confluence-importer` | `services/confluence-importer/Dockerfile` |
| `<user>/fredy-postgres` | mirror of `pgvector/pgvector:pg17` |
| `<user>/fredy-openwebui` | mirror of `ghcr.io/open-webui/open-webui:main` |

**Tag a release (automatic, change-detected):**

```bash
git tag v0.0.1
git push origin v0.0.1
```

Only images whose sources changed since the previous tag are rebuilt:
`services/<name>/**` rebuilds that service; a change to `packages/common/**`,
`pnpm-lock.yaml` or the root `package.json` rebuilds **both** services; a change
to `docker-compose.yml` re-mirrors postgres + openwebui. The first tag (no
previous tag) builds everything. A GitHub release with generated notes is
created.

**Release a single image manually:** run the **Release** workflow from the
Actions tab (`workflow_dispatch`), enter the version and tick only the images
you want. Untick `create_release` for a plain image rebuild without a GitHub
release.

## Repository Structure

```
services/              # Individual services
  confluence-importer/ # Confluence → pgvector ingestion (TypeScript)
  agent/               # AI agent (TypeScript, NestJS)
packages/              # Shared workspace libraries
  common/              # Logger + OTel tracing helpers
data/
  confluence-files/    # Mount local files for ingestion
prompts/               # Implementation guides
infrastructure/        # Additional deployment configs (Keycloak realm, etc.)
```

## Security Note

The `docker-compose.yml` reads secrets from environment variables. Never commit your `.env` file. Before any production deployment, migrate secrets to a dedicated secrets manager.
