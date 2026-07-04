import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { emitLogEvent, truncateForLog } from "../../observability/log-events.js";
import {
  classificationSchema,
  CONFIDENCE_FLOOR,
  MAX_CLARIFICATION_ROUNDS,
  MAX_RETRIEVAL_ROUNDS,
  type Classification,
} from "../classification.js";
import type { TriageGraphDeps } from "../deps.js";
import type { TicketState } from "../state.js";
import { buildClassifyInput, CLASSIFY_SYSTEM_PROMPT } from "../prompts/classify.js";
import { isSafeLanguageTag } from "../../language.js";

/**
 * The LLM proposes, code disposes: the structured decision is post-processed
 * with hard overrides so a hallucinated path can never bypass the guards.
 */
export function applyOverrides(parsed: Classification, state: TicketState): Classification {
  let path = parsed.path;
  if (path === "use_cache" && state.cacheHits.length === 0) {
    path = "need_context";
  }
  if (path === "need_context" && state.retrievalRounds >= MAX_RETRIEVAL_ROUNDS) {
    // Retrieval budget spent. With evidence in hand the model can answer;
    // without any it must not post a know-nothing resolution — give the
    // reporter a chance to add context while clarification budget remains.
    const hasEvidence = state.context !== null || state.cacheHits.length > 0;
    path =
      hasEvidence || state.clarificationRounds >= MAX_CLARIFICATION_ROUNDS
        ? "answer"
        : "ask_reporter";
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
    // language flows into compose system prompts; a free-form value from the
    // LLM would be a second-order injection channel, so gate it hard.
    const language = isSafeLanguageTag(parsed.language) ? parsed.language : state.language;
    const classification = applyOverrides({ ...parsed, language }, state);

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
      language: classification.language,
    };
  };
}
