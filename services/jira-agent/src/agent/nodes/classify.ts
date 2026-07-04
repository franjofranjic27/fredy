import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { emitLogEvent, truncateForLog } from "../../observability/log-events.js";
import {
  classificationSchema,
  CONFIDENCE_FLOOR,
  MAX_RETRIEVAL_ROUNDS,
  type Classification,
} from "../classification.js";
import type { TriageGraphDeps } from "../deps.js";
import type { TicketState } from "../state.js";
import { buildClassifyInput, CLASSIFY_SYSTEM_PROMPT } from "../prompts/classify.js";

/**
 * The LLM proposes, code disposes: the structured decision is post-processed
 * with hard overrides so a hallucinated path can never bypass the guards.
 */
export function applyOverrides(parsed: Classification, state: TicketState): Classification {
  let path = parsed.path;
  if (path === "use_cache" && state.cacheHits.length === 0) {
    path = state.retrievalRounds < MAX_RETRIEVAL_ROUNDS ? "need_context" : "answer";
  }
  if (path === "need_context" && state.retrievalRounds >= MAX_RETRIEVAL_ROUNDS) {
    path = "answer";
  }
  if (parsed.confidence < CONFIDENCE_FLOOR) {
    path = "escalate";
  }
  return path === parsed.path ? parsed : { ...parsed, path };
}

export function makeClassifyNode(deps: TriageGraphDeps) {
  return async (state: TicketState, config: RunnableConfig): Promise<Partial<TicketState>> => {
    if (!state.ticket) return {};
    const input = buildClassifyInput(
      state.ticket,
      deps.agentAccountId,
      state.cacheHits,
      state.context,
    );
    const parsed = await deps.invokeStructured(
      classificationSchema,
      [new SystemMessage(CLASSIFY_SYSTEM_PROMPT), new HumanMessage(input)],
      config,
    );
    const classification = applyOverrides(parsed, state);

    emitLogEvent(deps.logger, {
      type: "classification",
      agent: "jira-agent",
      issueKey: state.issueKey,
      requestId: state.requestId,
      path: classification.path,
      confidence: classification.confidence,
      language: classification.language,
      retrievalRounds: state.retrievalRounds,
      reasoning: truncateForLog(classification.reasoning),
      coercedFrom: classification.path === parsed.path ? undefined : parsed.path,
    });

    return {
      classification,
      language: classification.language || state.language,
    };
  };
}
