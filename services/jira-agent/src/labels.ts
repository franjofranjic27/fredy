/**
 * Jira labels are the agent's claim protocol and source of truth for
 * idempotency: they are human-visible on the board, survive restarts and
 * need no extra storage. See processor.ts for the lifecycle.
 */
export const LABEL_IN_PROGRESS = "fredy-in-progress";
export const LABEL_DONE = "fredy-done";
export const LABEL_FAILED = "fredy-failed";

export const ALL_AGENT_LABELS = [LABEL_IN_PROGRESS, LABEL_DONE, LABEL_FAILED] as const;
