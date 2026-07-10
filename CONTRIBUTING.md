# Contributing to fredy

## Setup

**Prerequisites:** Node.js 22+, [pnpm](https://pnpm.io) 10, [uv](https://docs.astral.sh/uv/) (for the Python services), Docker with Compose v2

```bash
pnpm install --frozen-lockfile

# Install git hooks (lefthook: commit-msg validation, lint/typecheck/test on commit)
pnpm exec lefthook install
```

## Development

The infrastructure (Postgres/pgvector, Keycloak, Open-WebUI, Jaeger) runs via
`docker compose up -d`; the services can then be run locally:

```bash
# TypeScript services (agent, jira-agent) and packages/agent-core
cd services/agent && pnpm dev

# Python services (confluence-importer, eval)
cd services/confluence-importer && uv run <entrypoint>
```

## Quality gates

Run before pushing (CI runs the same steps — see `.github/workflows/ci.yml`):

```bash
# per TypeScript module
pnpm exec tsc --noEmit && pnpm lint && pnpm test

# per Python module
uv run ruff check . && uv run ruff format --check . && uv run pytest
```

## Commits & pull requests

- Commit messages follow the convention in [CLAUDE.md](CLAUDE.md#commit-convention)
  (`<type>(<scope>): <summary>`); the commit-msg hook enforces it.
- One logical change per commit; PRs use the templates from
  [franjofranjic27/.github](https://github.com/franjofranjic27/.github)
  (`dependency-update.md` for dependency PRs, `sonar-fix.md` for Sonar fixes).
- CI and SonarCloud must be green before merge.

## Releases

Tag-driven — see the [README](README.md#releases).
