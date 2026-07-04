import { formatHit } from "@fredy/agent-core";
import { emitLogEvent, truncateForLog } from "../../observability/log-events.js";
import type { TriageGraphDeps } from "../deps.js";
import type { TicketState } from "../state.js";

const BLOCK_SEPARATOR = "\n\n---\n\n";

export function makeRetrieveContextNode(deps: TriageGraphDeps) {
  return async (state: TicketState): Promise<Partial<TicketState>> => {
    const startedAt = Date.now();
    const query =
      state.classification?.retrievalQuery ??
      state.cacheQuestion ??
      state.ticket?.issue.summary ??
      "";
    const vector = await deps.embeddings.embedQuery(query);
    const hits = await deps.chunks.search(vector, {
      limit: deps.retrieval.defaultLimit,
      scoreThreshold: deps.retrieval.scoreThreshold,
    });

    emitLogEvent(deps.logger, {
      type: "retrieval",
      agent: "jira-agent",
      issueKey: state.issueKey,
      requestId: state.requestId,
      query: truncateForLog(query),
      resultCount: hits.length,
      chunks: hits.map((hit) => ({ id: hit.id, score: hit.score, url: hit.payload.url })),
      durationMs: Date.now() - startedAt,
    });

    const context =
      hits.length > 0
        ? hits.map((hit, index) => formatHit(hit, index)).join(BLOCK_SEPARATOR)
        : null;
    return { context, retrievalRounds: state.retrievalRounds + 1 };
  };
}
