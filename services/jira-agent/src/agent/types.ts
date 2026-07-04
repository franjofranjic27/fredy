/** A ticket the runtime wants processed, from the poller or the webhook. */
export interface TicketEvent {
  readonly issueKey: string;
  readonly trigger: "assigned" | "reprocess";
}

/**
 * Abstract status changes; the executor resolves them to concrete transition
 * ids via the configured name allow-list — the LLM never sees raw ids.
 */
export type TransitionIntent = "resolve" | "waiting-for-reporter";

export type TicketOutcomePath = "cached" | "handler" | "answered" | "clarification" | "escalated";

export interface TicketOutcome {
  readonly issueKey: string;
  readonly path: TicketOutcomePath;
  readonly actionsApplied: readonly string[];
}

/**
 * The decide-and-act core. Implementations read the ticket, decide a path
 * and apply Jira-internal actions; the processor around it owns the label
 * claim lifecycle.
 */
export interface TicketAgent {
  process(event: TicketEvent, signal?: AbortSignal): Promise<TicketOutcome>;
}
