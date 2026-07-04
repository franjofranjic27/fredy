import { randomUUID } from "node:crypto";
import { context as otelContext, trace, SpanStatusCode } from "@opentelemetry/api";
import { AGENT, OtelCallbackHandler } from "@fredy/agent-core";
import type { ActionExecutor } from "../actions/executor.js";
import type { TriageGraphDeps } from "./deps.js";
import { buildTriageGraph } from "./graph.js";
import { initialTicketState } from "./state.js";
import type { TicketAgent, TicketEvent, TicketOutcome } from "./types.js";

export const JIRA_AGENT_NAME = "jira-agent";

export interface TriageTicketAgentDeps {
  readonly graphDeps: TriageGraphDeps;
  readonly executor: ActionExecutor;
}

const tracer = trace.getTracer("fredy-jira-agent");

/**
 * Decide (graph: reads + LLM only) then act (executor: gated writes) — the
 * separation gives one audit trail per planned and applied action and a
 * clean HITL insertion point before anything leaves Jira.
 */
export function createTriageTicketAgent(deps: TriageTicketAgentDeps): TicketAgent {
  const graph = buildTriageGraph(deps.graphDeps);
  const otelCallback = new OtelCallbackHandler();

  return {
    async process(event: TicketEvent, signal?: AbortSignal): Promise<TicketOutcome> {
      const requestId = `${event.issueKey}-${randomUUID()}`;
      const span = tracer.startSpan("ticket.process", {
        attributes: { [AGENT.NAME]: JIRA_AGENT_NAME, [AGENT.SESSION_ID]: event.issueKey },
      });
      try {
        const finalState = await otelContext.with(trace.setSpan(otelContext.active(), span), () =>
          graph.invoke(initialTicketState(event.issueKey, requestId, event.trigger), {
            callbacks: [otelCallback],
            runName: JIRA_AGENT_NAME,
            signal,
          }),
        );

        const actionsApplied = await deps.executor.apply({
          issueKey: event.issueKey,
          requestId,
          actions: finalState.actions,
          cacheWrite: finalState.cacheWrite,
          recordHitFor: finalState.recordHitFor,
        });

        span.setStatus({ code: SpanStatusCode.OK });
        return {
          issueKey: event.issueKey,
          path: finalState.outcome ?? "escalated",
          actionsApplied,
        };
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        otelCallback.endOpenSpans();
        span.end();
      }
    },
  };
}
