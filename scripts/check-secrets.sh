#!/usr/bin/env bash
# Scans staged changes for common secret patterns.
# Only checks added lines (lines starting with +) to avoid false positives
# from existing content in the diff context.

PATTERN='(api_key|apikey|api_token|auth_token|secret_key|password)\s*[=:]\s*["'"'"'][A-Za-z0-9_\-]{20,}["'"'"']'

matches=$(git diff --cached | grep -E '^\+[^+]' | grep -iE "$PATTERN")

if [ -n "$matches" ]; then
  echo ""
  echo "  ✗  Possible secret in staged changes:"
  echo ""
  echo "$matches" | head -5 | sed 's/^/     /'
  echo ""
  echo "  Review the above lines. If this is a false positive, commit with:"
  echo "    git commit --no-verify"
  echo ""
  exit 1
fi
