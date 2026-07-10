# AGENTS.md

Style and workflow rules for coding agents working in this repository.
Project overview, commands and commit convention: see [CLAUDE.md](CLAUDE.md).

## TypeScript (packages/agent-core, services/agent, services/jira-agent)

- Strict TypeScript — no `any` unless unavoidable; prefer explicit return types
  on exported functions.
- Formatting via Prettier (`.prettierrc`), linting via ESLint per module
  (`pnpm lint`); do not fight the formatter.
- NestJS idioms in `services/agent`: constructor injection, one provider per
  concern, DTOs validated at the boundary.
- Tests with Vitest (`pnpm test`), colocated per module; follow
  given/when/then structure.
- Never log secrets or document contents; use the shared logger/tracing from
  `packages/agent-core`.

## Python (services/confluence-importer, services/eval)

- Python ≥ 3.12, dependencies managed with `uv` (lockfile `uv.lock`).
- Lint/format with ruff: `uv run ruff check . && uv run ruff format --check .`
- Tests with pytest under `tests/`.
- Type hints on public functions; prefer dataclasses/pydantic models over dicts.

## Quality gates

Pre-commit hooks (lefthook) run typecheck, lint and tests per module — keep
them green. CI (`.github/workflows/ci.yml`) runs the same steps plus builds.

## Pull Requests

- Repo-wide standards and templates: https://github.com/franjofranjic27/.github (`REPO_STANDARDS.md`).
- Use the matching PR template from that repo (`gh pr create --body-file`):
  `dependency-update.md` for dependency updates, `sonar-fix.md` for Sonar fixes,
  `PULL_REQUEST_TEMPLATE.md` otherwise.
