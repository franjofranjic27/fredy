import type { Logger } from "@fredy/agent-core";
import type { TicketAgent, TicketEvent, TicketOutcome } from "./types.js";

/** Placeholder core until the triage graph lands — logs and does nothing. */
export function createNoopTicketAgent(logger: Logger): TicketAgent {
  return {
    async process(event: TicketEvent): Promise<TicketOutcome> {
      logger.info(`Ticket agent noop: would process ${event.issueKey} (${event.trigger})`);
      return { issueKey: event.issueKey, path: "noop", actionsApplied: [] };
    },
  };
}
