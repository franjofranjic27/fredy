# Pre-commit Hooks

Managed with [lefthook](https://github.com/evilmartians/lefthook) — a single `lefthook.yml`
at the repo root runs hooks in parallel across all services.

## Setup

```bash
# Install lefthook and set up git hooks
pnpm install          # at repo root
# lefthook install runs automatically via the prepare script
```

To run hooks manually without committing:

```bash
pnpm exec lefthook run pre-commit
pnpm exec lefthook run commit-msg --env LEFTHOOK_COMMIT_MSG_FILE=.git/COMMIT_EDITMSG
```

---

## Hooks

### `commit-msg` — enforce commit format

Validates the subject line against the convention defined in `CLAUDE.md`:

```
<type>(<scope>): <short summary>
```

**Allowed types:** `feat` `fix` `refactor` `docs` `chore` `test` `ci` `build`

**Scope:** optional, lowercase kebab-case (e.g. `agent`, `confluence-importer`, `infra`)

**Subject rules:** imperative mood, lowercase, no trailing period, max 72 chars

Examples of valid messages:

```
feat(confluence-importer): add retry logic for embedding API calls
fix(agent): handle empty tool response
chore: update root package.json with lefthook
docs(confluence-importer): add chunking strategy to README
```

Validation script: `scripts/validate-commit-msg.sh`

---

### `pre-commit` — type check (both services, parallel)

Runs `tsc --noEmit` in both `services/agent` and `services/confluence-importer` simultaneously.
Catches type errors before they land on main. Takes ~3–5 seconds.

```yaml
typecheck-agent:
  run: cd services/agent && pnpm exec tsc --noEmit
typecheck-confluence-importer:
  run: cd services/confluence-importer && pnpm exec tsc --noEmit
```

---

### `pre-commit` — test suite

`services/agent` tests run on every commit. `services/confluence-importer` tests are commented out
until [Todo 4](../services/confluence-importer/todos/04-tests-vitest.md) is implemented.

```yaml
test-agent:
  run: cd services/agent && pnpm test
# test-confluence-importer:        # enable after Todo 4
#   run: cd services/confluence-importer && pnpm test:run
```

---

### `pre-commit` — secret scan

Greps staged changes for common secret patterns (API keys, tokens).
Only scans added lines (lines starting with `+` in the diff).

Patterns caught:
- `SOME_KEY = "sk-..."`
- `api_token: "AKIA..."`
- Generic assignment of 20+ char alphanumeric strings to key/token/secret fields

This is a lightweight heuristic. For stronger guarantees, install
[gitleaks](https://github.com/gitleaks/gitleaks) and swap in `gitleaks protect --staged`.

---

## Skipping Hooks

Only use when you know what you're doing:

```bash
git commit --no-verify -m "chore: wip"
```

---

## Adding New Services

When a new service is added to `services/`:

1. Add a `typecheck-<name>` command to `lefthook.yml`
2. Add a `test-<name>` command (commented out until tests exist)
3. Update this doc
