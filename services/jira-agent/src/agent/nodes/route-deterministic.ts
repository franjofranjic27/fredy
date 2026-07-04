import type { TriageGraphDeps } from "../deps.js";
import type { TicketState } from "../state.js";

/** Pure code routing — the cheapest, most predictable path runs first. */
export function makeRouteDeterministicNode(deps: TriageGraphDeps) {
  return (state: TicketState): Partial<TicketState> => {
    if (!state.ticket) return {};
    const handler = deps.handlers.match(state.ticket);
    if (handler) {
      deps.logger.debug(`Deterministic handler matched ${state.issueKey}: ${handler.id}`);
    }
    return { handlerId: handler?.id };
  };
}
