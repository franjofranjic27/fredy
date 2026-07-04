import type { TriageGraphDeps } from "../deps.js";
import type { TicketState } from "../state.js";

export function makeRunHandlerNode(deps: TriageGraphDeps) {
  return async (state: TicketState): Promise<Partial<TicketState>> => {
    if (!state.ticket || !state.handlerId) return {};
    const handler = deps.handlers.list().find((entry) => entry.id === state.handlerId);
    if (!handler) return {};
    const result = await handler.handle(state.ticket, { logger: deps.logger });
    return { handlerResult: result, draftComment: result.comment, outcome: "handler" };
  };
}
