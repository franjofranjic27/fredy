/** A ticket the runtime wants processed, from the poller or the webhook. */
export interface TicketEvent {
  readonly issueKey: string;
  readonly trigger: "assigned" | "reprocess";
}

export type TicketOutcomePath =
  | "cached"
  | "handler"
  | "answered"
  | "clarification"
  | "escalated"
  | "noop";

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
