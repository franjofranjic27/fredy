#!/usr/bin/env bash
# Validates that the commit subject line follows the convention defined in CLAUDE.md:
#   <type>(<scope>): <summary>
# Scope is optional. Subject must be lowercase, imperative, max 72 chars, no trailing period.

MSG_FILE="${1:-${LEFTHOOK_COMMIT_MSG_FILE}}"

if [ -z "$MSG_FILE" ]; then
  echo "validate-commit-msg: no message file provided" >&2
  exit 1
fi

subject=$(head -1 "$MSG_FILE")

# Strip comment lines (git adds them when using -v or templates)
subject=$(echo "$subject" | sed 's/^#.*//')
subject=$(echo "$subject" | xargs)  # trim whitespace

# Allow empty subject (git will catch it separately)
if [ -z "$subject" ]; then
  exit 0
fi

# Allow merge commits
if echo "$subject" | grep -qE "^Merge "; then
  exit 0
fi

PATTERN="^(feat|fix|refactor|docs|chore|test|ci|build)(\([a-z][a-z0-9-]*\))?: .{1,72}$"

if ! echo "$subject" | grep -qE "$PATTERN"; then
  echo ""
  echo "  ✗  Invalid commit message:"
  echo "     $subject"
  echo ""
  echo "  Expected format: <type>(<scope>): <summary>"
  echo "  Types: feat | fix | refactor | docs | chore | test | ci | build"
  echo "  Scope: optional, lowercase (e.g. agent, rag, infra)"
  echo "  Summary: lowercase, imperative, no trailing period, max 72 chars"
  echo ""
  echo "  Examples:"
  echo "    feat(rag): add retry logic for embedding API calls"
  echo "    fix(agent): handle empty tool response"
  echo "    chore: update lefthook configuration"
  echo ""
  exit 1
fi
