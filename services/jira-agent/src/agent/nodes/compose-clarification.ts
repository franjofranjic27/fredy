import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { contentToString } from "@fredy/agent-core";
import { emitLogEvent } from "../../observability/log-events.js";
import type { TriageGraphDeps } from "../deps.js";
import type { TicketState } from "../state.js";
import { addUsage, extractResponseModel, extractUsage } from "../llm.js";
import {
  buildClarificationInput,
  CLARIFICATION_MARKER,
  clarificationSystemPrompt,
} from "../prompts/clarification.js";

export function makeComposeClarificationNode(deps: TriageGraphDeps) {
  return async (state: TicketState, config: RunnableConfig): Promise<Partial<TicketState>> => {
    if (!state.ticket) return {};
    const startedAt = Date.now();
    const model = deps.createModel();
    const response = await model.invoke(
      [
        new SystemMessage(clarificationSystemPrompt(state.language)),
        new HumanMessage(
          buildClarificationInput(
            state.ticket,
            deps.agentAccountId,
            state.classification?.missingInfo ?? [],
          ),
        ),
      ],
      config,
    );
    const usage = extractUsage(response);

    emitLogEvent(deps.logger, {
      type: "llm-call",
      agent: "jira-agent",
      issueKey: state.issueKey,
      requestId: state.requestId,
      purpose: "clarification",
      model: extractResponseModel(response),
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      durationMs: Date.now() - startedAt,
    });

    // Marker appended in code — round counting must never depend on the LLM.
    const draftComment = `${contentToString(response.content)}\n\n${CLARIFICATION_MARKER}`;
    return {
      draftComment,
      outcome: "clarification",
      usage: addUsage(state.usage, usage),
    };
  };
}
