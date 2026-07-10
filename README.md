# fredy

[![CI](https://img.shields.io/github/actions/workflow/status/franjofranjic27/fredy/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/franjofranjic27/fredy/actions/workflows/ci.yml)
[![Quality Gate](https://img.shields.io/sonar/quality_gate/franjofranjic27_fredy?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge)](https://sonarcloud.io/summary/overall?id=franjofranjic27_fredy)
[![Coverage](https://img.shields.io/sonar/coverage/franjofranjic27_fredy?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge)](https://sonarcloud.io/summary/overall?id=franjofranjic27_fredy)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge)](#tech-stack)
[![Python](https://img.shields.io/badge/Python-3.12-yellow?style=for-the-badge)](#tech-stack)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

fredy 🐨 makes your company knowledge available like a teammate: an AI agent
platform with a RAG pipeline over Confluence content, vector search in
PostgreSQL/pgvector and an OpenAI-compatible agent service backed by Claude —
all self-hosted via Docker Compose.

![fredy-logo.png](docs/assets/fredy-logo.png)

## Project Status

In active development. Docker images are published to Docker Hub (multi-arch,
`linux/amd64` + `linux/arm64`) via tagged releases — see
[Releases](#releases).

## Quick Start

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) with Compose v2, an [Anthropic API key](https://console.anthropic.com/)

```bash
# 1. Configure secrets
cp .env.example .env       # minimum: ANTHROPIC_API_KEY=sk-ant-...

# 2. Start all services
docker compose up -d

# 3. Open the UI
open http://localhost:3000
```

Open-WebUI is wired to the fredy agent service; the model dropdown lists
exactly one entry, `rag-agent` — a deterministic RAG agent whose answers are
grounded in the Confluence content stored in pgvector. New agents added under
`services/agent/src/agents/` automatically show up here.

### Services

| Service | URL | Description |
|---------|-----|-------------|
| Open-WebUI | http://localhost:3000 | Chat interface — talks to the fredy agent |
| Fredy Agent | http://localhost:8001 | OpenAI-compatible RAG agent (single model: `rag-agent`) |
| PostgreSQL / pgvector | localhost:5432 | Vector database (fredy RAG + Open-WebUI) |
| Confluence Importer | — | Background sync: Confluence / local files → pgvector |
| Keycloak | http://localhost:8080 | OAuth provider for Open-WebUI |
| Jaeger | http://localhost:16686 | OpenTelemetry trace viewer |

### Common commands

```bash
docker compose up -d              # Start all services in background
docker compose down               # Stop all services
docker compose logs -f confluence-importer  # Stream logs for the importer
docker compose restart openwebui  # Restart a single service
docker compose pull               # Pull latest images
```

## Configuration

### Confluence ingestion (optional)

The `confluence-importer` container syncs documents into PostgreSQL/pgvector so
the agent can search them. Add these variables to your `.env`:

```env
CONFLUENCE_BASE_URL=https://your-org.atlassian.net
CONFLUENCE_USERNAME=you@example.com
CONFLUENCE_API_TOKEN=your-token
CONFLUENCE_SPACES=ENG,OPS          # comma-separated space keys
EMBEDDING_PROVIDER=openai           # or voyage
EMBEDDING_API_KEY=sk-...
```

### Local file ingestion (optional)

Place `.md`, `.txt`, or `.html` files in `data/confluence-files/` and enable
the feature:

```env
LOCAL_FILES_ENABLED=true
```

The importer syncs every 6 hours by default (`SYNC_CRON=0 */6 * * *`). To
trigger a full sync on startup: `SYNC_FULL_ON_START=true`.

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| TypeScript | 5 | Agent services (pnpm workspace monorepo, NestJS) |
| Python | 3.12 | Confluence importer + RAG eval harness (uv, ruff) |
| PostgreSQL / pgvector | 17 | Vector database |
| Claude API | — | LLM provider for the agents |
| Open-WebUI | — | Chat frontend |
| Keycloak | — | OAuth provider |
| OpenTelemetry / Jaeger | — | Tracing |

## Releases

Docker images are published to Docker Hub (multi-arch) and a GitHub release is
cut per version. One-time setup (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
|------|------|-------|
| Variable | `DOCKERHUB_USERNAME` | your Docker Hub namespace (user or org) |
| Secret | `DOCKERHUB_TOKEN` | a Docker Hub access token with write scope |

Images (each tagged `0.0.1`, `0.0` and `latest`):

| Image | Source |
|-------|--------|
| `<user>/fredy-agent` | `services/agent/Dockerfile` |
| `<user>/fredy-jira-agent` | `services/jira-agent/Dockerfile` |
| `<user>/fredy-confluence-importer` | `services/confluence-importer/Dockerfile` |
| `<user>/fredy-postgres` | mirror of `pgvector/pgvector:pg17` |
| `<user>/fredy-openwebui` | mirror of `ghcr.io/open-webui/open-webui:main` |

**Tag a release (automatic, change-detected):**

```bash
git tag v0.0.1
git push origin v0.0.1
```

Only images whose sources changed since the previous tag are rebuilt:
`services/<name>/**` rebuilds that service; a change to `packages/agent-core/**`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml` or the root `package.json` rebuilds the
TypeScript services; a change to `docker-compose.yml` re-mirrors postgres +
openwebui. The first tag (no previous tag) builds everything. A GitHub release
with generated notes is created.

**Release a single image manually:** run the **Release** workflow from the
Actions tab (`workflow_dispatch`), enter the version and tick only the images
you want. Untick `create_release` for a plain image rebuild without a GitHub
release.

## Repository Structure

```
services/              # Individual services
  agent/               # AI agent (TypeScript, NestJS)
  jira-agent/          # Jira integration agent (TypeScript)
  confluence-importer/ # Confluence → pgvector ingestion (Python, uv)
  eval/                # RAG retrieval evaluation harness (Python, uv)
packages/              # Shared workspace libraries
  agent-core/          # Shared agent runtime (TypeScript)
data/
  confluence-files/    # Mount local files for ingestion
infrastructure/        # Additional deployment configs (Keycloak realm, etc.)
```

## Documentation

| Document | Description |
|---|---|
| [Docs site](https://franjofranjic27.github.io/fredy/) | Rendered documentation (GitHub Pages) |
| [docs/aiops-architecture.md](docs/aiops-architecture.md) | AIOps agent architecture |
| [docs/confluence-importer-architecture.md](docs/confluence-importer-architecture.md) | Importer architecture |
| [docs/agent-flow-diagram.md](docs/agent-flow-diagram.md) | How a chat request is processed |
| [docs/rag-eval-guide.md](docs/rag-eval-guide.md) | RAG evaluation guide |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor setup and workflow |

Repo-wide conventions (README/badge standard, PR and issue templates) live in
[franjofranjic27/.github](https://github.com/franjofranjic27/.github).

## Security Note

The `docker-compose.yml` reads secrets from environment variables. Never commit
your `.env` file. Before any production deployment, migrate secrets to a
dedicated secrets manager.

## License

[MIT](LICENSE)
