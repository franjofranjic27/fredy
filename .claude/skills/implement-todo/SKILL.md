---
name: implement-todo
description: Implement a todo from the agent todos directory, verify the build, commit and push.
argument-hint: <todo-filename>
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(npx tsc *), Bash(pnpm *), Bash(git *)
---

# Implement Todo

Implement the todo described in the given file, verify the build, then commit and push.

## Input

`$ARGUMENTS` is the filename (with or without path) of a todo markdown file.
Look for it in `services/agent/todos/` if no path is given.

## Steps

1. **Read the todo file** and understand the requirements, affected files, and implementation steps.
2. **Read all affected source files** listed in the todo before making any changes.
3. **Implement the changes** as described in the todo. Follow the implementation steps closely.
4. **Verify the build** by running `npx tsc --noEmit` in the relevant service directory. Fix any type errors before proceeding.
5. **Commit the changes**:
   - Stage only the files that were changed for this todo (not unrelated changes).
   - Write a commit message following the project's commit convention from CLAUDE.md.
   - The commit message must reflect the actual change, not just reference the todo number.
   - End the commit message with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.
6. **Push** to the remote.
7. **Report** a summary of what was changed and the commit hash.
