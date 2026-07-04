import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { contentToString } from "@fredy/agent-core";
import { emitLogEvent } from "../../observability/log-events.js";
import type { TriageGraphDeps } from "../deps.js";
import type { TicketState } from "../state.js";
import { addUsage, extractResponseModel, extractUsage } from "../llm.js";
import { answerSystemPrompt, buildAnswerInput } from "../prompts/answer.js";

export function makeComposeAnswerNode(deps: TriageGraphDeps) {
  return async (state: TicketState, config: RunnableConfig): Promise<Partial<TicketState>> => {
    if (!state.ticket) return {};
    const startedAt = Date.now();
    const model = deps.createModel();
    const response = await model.invoke(
      [
        new SystemMessage(answerSystemPrompt(state.language)),
        new HumanMessage(
          buildAnswerInput(state.ticket, deps.agentAccountId, state.cacheHits, state.context),
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
      purpose: "answer",
      model: extractResponseModel(response),
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      durationMs: Date.now() - startedAt,
    });

    return {
      draftComment: contentToString(response.content),
      outcome: state.classification?.path === "use_cache" ? "cached" : "answered",
      usage: addUsage(state.usage, usage),
    };
  };
}
