import { END, START, StateGraph } from "@langchain/langgraph";
import { MAX_CLARIFICATION_ROUNDS } from "./classification.js";
import type { TriageGraphDeps } from "./deps.js";
import { TicketStateAnnotation, type TicketState } from "./state.js";
import { makeCacheLookupNode } from "./nodes/cache-lookup.js";
import { makeClassifyNode } from "./nodes/classify.js";
import { makeComposeAnswerNode } from "./nodes/compose-answer.js";
import { makeComposeClarificationNode } from "./nodes/compose-clarification.js";
import { composeEscalationNode } from "./nodes/compose-escalation.js";
import { makeFetchTicketNode } from "./nodes/fetch-ticket.js";
import { makePlanActionsNode } from "./nodes/plan-actions.js";
import { makeRetrieveContextNode } from "./nodes/retrieve-context.js";
import { makeRouteDeterministicNode } from "./nodes/route-deterministic.js";
import { makeRunHandlerNode } from "./nodes/run-handler.js";

function afterClassify(state: TicketState): string {
  switch (state.classification?.path) {
    case "use_cache":
    case "answer":
      return "compose_answer";
    case "need_context":
      return "retrieve_context";
    case "ask_reporter":
      return "compose_clarification";
    default:
      return "compose_escalation";
  }
}

/**
 * Deterministic triage state machine (plan B1). The LLM only classifies and
 * writes text; branching is plain code, retrieval runs at most once, and too
 * many unanswered clarification rounds escalate to a human.
 */
export function buildTriageGraph(deps: TriageGraphDeps) {
  return new StateGraph(TicketStateAnnotation)
    .addNode("fetch_ticket", makeFetchTicketNode(deps))
    .addNode("route_deterministic", makeRouteDeterministicNode(deps))
    .addNode("run_handler", makeRunHandlerNode(deps))
    .addNode("cache_lookup", makeCacheLookupNode(deps))
    .addNode("classify", makeClassifyNode(deps))
    .addNode("retrieve_context", makeRetrieveContextNode(deps))
    .addNode("compose_answer", makeComposeAnswerNode(deps))
    .addNode("compose_clarification", makeComposeClarificationNode(deps))
    .addNode("compose_escalation", composeEscalationNode)
    .addNode("plan_actions", makePlanActionsNode(deps))
    .addEdge(START, "fetch_ticket")
    .addConditionalEdges(
      "fetch_ticket",
      (state) =>
        state.clarificationRounds >= MAX_CLARIFICATION_ROUNDS
          ? "compose_escalation"
          : "route_deterministic",
      ["compose_escalation", "route_deterministic"],
    )
    .addConditionalEdges(
      "route_deterministic",
      (state) => (state.handlerId ? "run_handler" : "cache_lookup"),
      ["run_handler", "cache_lookup"],
    )
    .addEdge("run_handler", "plan_actions")
    .addEdge("cache_lookup", "classify")
    .addConditionalEdges("classify", afterClassify, [
      "compose_answer",
      "retrieve_context",
      "compose_clarification",
      "compose_escalation",
    ])
    .addEdge("retrieve_context", "classify")
    .addEdge("compose_answer", "plan_actions")
    .addEdge("compose_clarification", "plan_actions")
    .addEdge("compose_escalation", "plan_actions")
    .addEdge("plan_actions", END)
    .compile();
}
