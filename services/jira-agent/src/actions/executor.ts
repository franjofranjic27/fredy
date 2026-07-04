import type { Logger } from "@fredy/agent-core";
import type { JiraClient } from "../jira/jira-client.js";
import { markdownToAdf } from "../jira/adf.js";
import type { CacheEntry, TicketCacheStore } from "../cache/ticket-cache.js";
import type { TransitionIntent } from "../agent/types.js";
import { emitLogEvent } from "../observability/log-events.js";
import { describeAction, type JiraAction } from "./actions.js";
import type { ActionGate } from "./action-gate.js";

export interface ActionExecutorDeps {
  readonly client: JiraClient;
  readonly gate: ActionGate;
  readonly cache: TicketCacheStore;
  /** Allow-listed transition names from config — never chosen by the LLM. */
  readonly transitionNames: Record<TransitionIntent, string>;
  readonly logger: Logger;
}

export interface ExecutionInput {
  readonly issueKey: string;
  readonly requestId: string;
  readonly actions: readonly JiraAction[];
  /** Written only after every action succeeded. */
  readonly cacheWrite?: CacheEntry;
  /** Cache entry that contributed to the posted answer. */
  readonly recordHitFor?: string;
}

/**
 * Applies the graph's action plan against Jira. Decide and act stay separate
 * on purpose: every action passes the gate, gets logged, and a mid-sequence
 * failure aborts the rest — including the cache write, so half-applied
 * resolutions never become future evidence.
 */
export function createActionExecutor(deps: ActionExecutorDeps) {
  const { client, gate, cache, transitionNames, logger } = deps;

  async function resolveTransitionId(issueKey: string, intent: TransitionIntent) {
    const wanted = transitionNames[intent].toLowerCase();
    const transitions = await client.getTransitions(issueKey);
    return transitions.find((transition) => transition.name.toLowerCase() === wanted);
  }

  async function applyOne(input: ExecutionInput, action: JiraAction): Promise<boolean> {
    const { issueKey, requestId } = input;
    await gate.approve(action, { issueKey });
    switch (action.type) {
      case "addComment":
        await client.addComment(issueKey, markdownToAdf(action.markdown));
        break;
      case "assignIssue":
        await client.assignIssue(issueKey, action.accountId);
        break;
      case "transition": {
        const transition = await resolveTransitionId(issueKey, action.intent);
        if (!transition) {
          // Workflows differ per project; a missing transition must not fail
          // an otherwise successful resolution.
          logger.warn(
            `No transition named "${transitionNames[action.intent]}" on ${issueKey} — skipping`,
          );
          emitLogEvent(logger, {
            type: "jira-action",
            agent: "jira-agent",
            issueKey,
            requestId,
            action: action.type,
            detail: describeAction(action),
            skipped: true,
          });
          return false;
        }
        await client.transitionIssue(issueKey, transition.id);
        break;
      }
    }
    emitLogEvent(logger, {
      type: "jira-action",
      agent: "jira-agent",
      issueKey,
      requestId,
      action: action.type,
      detail: describeAction(action),
    });
    return true;
  }

  return {
    /** Returns the descriptions of the actions actually applied. */
    async apply(input: ExecutionInput): Promise<string[]> {
      const applied: string[] = [];
      for (const action of input.actions) {
        try {
          const done = await applyOne(input, action);
          if (done) applied.push(describeAction(action));
        } catch (error) {
          logger.error(
            { err: error },
            `Action ${describeAction(action)} on ${input.issueKey} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          throw error;
        }
      }

      if (input.cacheWrite) {
        await cache.upsert(input.cacheWrite);
        emitLogEvent(logger, {
          type: "cache-write",
          agent: "jira-agent",
          issueKey: input.issueKey,
          requestId: input.requestId,
          cacheKey: input.cacheWrite.ticketKey,
        });
      }
      if (input.recordHitFor) {
        await cache.recordHit(input.recordHitFor);
      }
      return applied;
    },
  };
}

export type ActionExecutor = ReturnType<typeof createActionExecutor>;
