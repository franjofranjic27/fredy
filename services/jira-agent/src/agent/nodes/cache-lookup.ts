import { emitLogEvent } from "../../observability/log-events.js";
import type { TriageGraphDeps } from "../deps.js";
import type { TicketState } from "../state.js";

const MAX_QUESTION_CHARS = 8000;

/** Whitespace-normalised summary+description — the cache's semantic key. */
export function normalizeQuestion(summary: string, description: string): string {
  return `${summary}\n\n${description}`
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MAX_QUESTION_CHARS);
}

export function makeCacheLookupNode(deps: TriageGraphDeps) {
  return async (state: TicketState): Promise<Partial<TicketState>> => {
    if (!state.ticket) return {};
    const startedAt = Date.now();
    const question = normalizeQuestion(state.ticket.issue.summary, state.ticket.issue.description);
    const embedding = await deps.embeddings.embedQuery(question);
    const hits = await deps.cache.lookup(embedding, { projectKey: deps.projectKey });

    emitLogEvent(deps.logger, {
      type: "cache-lookup",
      agent: "jira-agent",
      issueKey: state.issueKey,
      requestId: state.requestId,
      resultCount: hits.length,
      topScore: hits[0]?.score,
      strong: hits[0]?.strong,
      durationMs: Date.now() - startedAt,
    });

    return { cacheHits: hits, cacheQuestion: question, cacheQueryEmbedding: embedding };
  };
}
