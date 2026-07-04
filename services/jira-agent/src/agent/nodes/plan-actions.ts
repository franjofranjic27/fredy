import type { JiraAction } from "../../actions/actions.js";
import type { CacheEntry } from "../../cache/ticket-cache.js";
import type { TriageGraphDeps } from "../deps.js";
import type { TicketState } from "../state.js";
import { CACHE_WRITE_MIN_CONFIDENCE } from "../classification.js";

function handlerActions(state: TicketState): JiraAction[] {
  const result = state.handlerResult;
  if (!result) return [];
  const actions: JiraAction[] = [{ type: "addComment", markdown: result.comment }];
  if (result.transitionIntent) {
    actions.push({ type: "transition", intent: result.transitionIntent });
  }
  if (result.assignTo === "reporter" && state.ticket?.issue.reporter) {
    actions.push({ type: "assignIssue", accountId: state.ticket.issue.reporter.accountId });
  }
  return actions;
}

function cacheWriteFor(state: TicketState, projectKey: string): CacheEntry | undefined {
  if (state.outcome !== "answered") return undefined;
  if ((state.classification?.confidence ?? 0) < CACHE_WRITE_MIN_CONFIDENCE) return undefined;
  if (!state.cacheQuestion || !state.cacheQueryEmbedding) return undefined;
  return {
    ticketKey: state.issueKey,
    // Must be the same value cache_lookup filters on — deriving it from the
    // issue-key prefix would silently split reads and writes.
    projectKey,
    questionText: state.cacheQuestion,
    resolutionText: state.draftComment,
    embedding: state.cacheQueryEmbedding,
  };
}

/**
 * Pure decision → action-plan mapping; the executor applies it afterwards.
 * Escalations post the comment but neither transition nor reassign — the
 * ticket stays visibly with the agent so a human notices and takes over.
 * Cache policy (docs/rag-eval-guide.md §6): only confident, fully answered
 * outcomes become future evidence — never clarifications, escalations,
 * handler output or answers that were themselves served from the cache.
 */
export function makePlanActionsNode(deps: TriageGraphDeps) {
  return (state: TicketState): Partial<TicketState> => {
    if (state.outcome === "handler") {
      return { actions: handlerActions(state) };
    }
    if (state.outcome === "answered" || state.outcome === "cached") {
      const actions: JiraAction[] = [
        { type: "addComment", markdown: state.draftComment },
        { type: "transition", intent: "resolve" },
      ];
      const strongHit = state.cacheHits.find((hit) => hit.strong);
      return {
        actions,
        cacheWrite: cacheWriteFor(state, deps.projectKey),
        recordHitFor: state.outcome === "cached" ? strongHit?.ticketKey : undefined,
      };
    }
    if (state.outcome === "clarification") {
      const actions: JiraAction[] = [{ type: "addComment", markdown: state.draftComment }];
      actions.push({ type: "transition", intent: "waiting-for-reporter" });
      if (state.ticket?.issue.reporter) {
        actions.push({ type: "assignIssue", accountId: state.ticket.issue.reporter.accountId });
      }
      return { actions };
    }
    return { actions: [{ type: "addComment", markdown: state.draftComment }] };
  };
}
