import { isProbablyGerman } from "../../language.js";
import { emitLogEvent } from "../../observability/log-events.js";
import type { TriageGraphDeps } from "../deps.js";
import type { TicketState } from "../state.js";
import { CLARIFICATION_MARKER } from "../prompts/clarification.js";

/**
 * Loads the ticket and reconstructs all agent state from Jira itself: the
 * clarification round is the count of the agent's own marker comments, so a
 * reprocess after the reporter replied needs no local memory.
 */
export function makeFetchTicketNode(deps: TriageGraphDeps) {
  return async (state: TicketState): Promise<Partial<TicketState>> => {
    const [issue, comments] = await Promise.all([
      deps.client.getIssue(state.issueKey),
      deps.client.getComments(state.issueKey),
    ]);
    const clarificationRounds = comments.filter(
      (comment) =>
        comment.author.accountId === deps.agentAccountId &&
        comment.body.includes(CLARIFICATION_MARKER),
    ).length;
    const language = isProbablyGerman(`${issue.summary}\n${issue.description}`) ? "de" : "en";

    emitLogEvent(deps.logger, {
      type: "ticket-event",
      agent: "jira-agent",
      issueKey: state.issueKey,
      requestId: state.requestId,
      trigger: state.trigger,
      clarificationRounds,
    });

    return { ticket: { issue, comments }, clarificationRounds, language };
  };
}
