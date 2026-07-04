import { Annotation } from "@langchain/langgraph";
import type { AgentUsage } from "@fredy/agent-core";
import type { CacheEntry, CacheHit } from "../cache/ticket-cache.js";
import type { HandlerResult } from "../handlers/handler.js";
import type { TicketSnapshot } from "../jira/types.js";
import type { JiraAction } from "../actions/actions.js";
import type { TicketOutcomePath } from "./types.js";
import type { Classification } from "./classification.js";

export const TicketStateAnnotation = Annotation.Root({
  issueKey: Annotation<string>,
  requestId: Annotation<string>,
  startedAt: Annotation<number>,
  trigger: Annotation<"assigned" | "reprocess">,
  ticket: Annotation<TicketSnapshot | undefined>,
  /** BCP-47-ish; heuristic start value, refined by the classifier. */
  language: Annotation<string>,
  /** Derived from the ticket's own comment history, not local state. */
  clarificationRounds: Annotation<number>,
  handlerId: Annotation<string | undefined>,
  handlerResult: Annotation<HandlerResult | undefined>,
  cacheHits: Annotation<readonly CacheHit[]>,
  /** Normalised summary+description; reused for the eventual cache write. */
  cacheQuestion: Annotation<string | undefined>,
  cacheQueryEmbedding: Annotation<readonly number[] | undefined>,
  classification: Annotation<Classification | undefined>,
  retrievalRounds: Annotation<number>,
  context: Annotation<string | null>,
  draftComment: Annotation<string>,
  outcome: Annotation<TicketOutcomePath | undefined>,
  actions: Annotation<readonly JiraAction[]>,
  cacheWrite: Annotation<CacheEntry | undefined>,
  recordHitFor: Annotation<string | undefined>,
  usage: Annotation<AgentUsage | undefined>,
});

export type TicketState = typeof TicketStateAnnotation.State;

export function initialTicketState(
  issueKey: string,
  requestId: string,
  trigger: "assigned" | "reprocess",
): TicketState {
  return {
    issueKey,
    requestId,
    startedAt: Date.now(),
    trigger,
    ticket: undefined,
    language: "en",
    clarificationRounds: 0,
    handlerId: undefined,
    handlerResult: undefined,
    cacheHits: [],
    cacheQuestion: undefined,
    cacheQueryEmbedding: undefined,
    classification: undefined,
    retrievalRounds: 0,
    context: null,
    draftComment: "",
    outcome: undefined,
    actions: [],
    cacheWrite: undefined,
    recordHitFor: undefined,
    usage: undefined,
  };
}
