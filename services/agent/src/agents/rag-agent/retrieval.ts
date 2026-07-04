import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { ToolMessage } from "@langchain/core/messages";
import { GEN_AI, type Logger, type ToolRegistry } from "@fredy/agent-core";
import { emitLogEvent } from "../../observability/log-events.js";
import type { Reranker } from "../../rerank/reranker.js";
import type { VectorSearchHit } from "../../tools/pgvector.js";
import { formatHit, VECTOR_SEARCH_TOOL_NAME } from "../../tools/vector-search.js";
import { splitQueries } from "./query-split.js";

const BLOCK_SEPARATOR = "\n\n---\n\n";

export interface RetrievalDeps {
  readonly toolRegistry: ToolRegistry;
  readonly reranker: Reranker | null;
  readonly rerankTopN: number;
  readonly rerankThreshold: number;
  readonly defaultLimit: number;
  readonly logger: Logger;
}

export interface RetrievalOptions {
  readonly requestId: string;
  readonly allowedToolNames?: readonly string[];
  readonly spaceKey?: string;
}

interface FetchOutcome {
  merged: string;
  hits: VectorSearchHit[];
}

const tracer = trace.getTracer("fredy-agent.retrieval");

/**
 * Deterministic retrieval for the RAG agent: expand the user message into up
 * to five queries, run vector_search per query, optionally rerank the pooled
 * hits, and return the merged context — or null when the tool is unavailable,
 * denied by RBAC, or yields nothing (which triggers the refusal path).
 */
export async function retrieveContext(
  userMessage: string,
  options: RetrievalOptions,
  deps: RetrievalDeps,
): Promise<string | null> {
  const { requestId, allowedToolNames, spaceKey } = options;
  if (!isToolAvailable(deps, allowedToolNames)) {
    deps.logger.warn("vector_search unavailable for this request — refusing to answer");
    emitLogEvent(deps.logger, {
      type: "retrieval",
      agent: "rag-agent",
      requestId,
      query: userMessage.trim() || "empty",
      resultCount: 0,
    });
    return null;
  }

  const queries = splitQueries(userMessage);
  const effective = queries.length > 0 ? queries : [userMessage.trim()].filter(Boolean);
  if (effective.length === 0) return null;

  let outcome = await fetchContext(effective, requestId, spaceKey, deps);
  if (outcome.merged.trim().length === 0 && effective.length > 1) {
    outcome = await fetchContext([userMessage.trim()].filter(Boolean), requestId, spaceKey, deps);
  }
  if (outcome.merged.trim().length === 0) return null;

  if (deps.reranker && outcome.hits.length > 0) {
    return rerankContext(userMessage, outcome, deps);
  }
  return outcome.merged;
}

function isToolAvailable(deps: RetrievalDeps, allowed?: readonly string[]): boolean {
  if (!deps.toolRegistry.has(VECTOR_SEARCH_TOOL_NAME)) return false;
  if (!allowed) return true;
  return allowed.includes(VECTOR_SEARCH_TOOL_NAME);
}

async function fetchContext(
  queries: string[],
  requestId: string,
  spaceKey: string | undefined,
  deps: RetrievalDeps,
): Promise<FetchOutcome> {
  const tool = deps.toolRegistry.get(VECTOR_SEARCH_TOOL_NAME);
  const blocks: string[] = [];
  const pooledHits = new Map<string, VectorSearchHit>();

  for (const query of queries) {
    const span = tracer.startSpan("rag-agent.retrieval", {
      attributes: { "request.id": requestId, [GEN_AI.RETRIEVAL_QUERY]: query },
    });
    const startedAt = Date.now();
    try {
      const message = (await tool!.invoke({
        type: "tool_call",
        id: `retrieval-${requestId}-${blocks.length}`,
        name: VECTOR_SEARCH_TOOL_NAME,
        args: { query, limit: deps.defaultLimit, spaceKey },
      })) as ToolMessage;
      const content = typeof message.content === "string" ? message.content : "";
      const hits = (message.artifact as { hits?: VectorSearchHit[] } | undefined)?.hits ?? [];
      span.setAttribute(GEN_AI.RETRIEVAL_RESULT_COUNT, hits.length);
      emitLogEvent(deps.logger, {
        type: "retrieval",
        agent: "rag-agent",
        requestId,
        query,
        resultCount: hits.length,
        chunks: hits.map((hit) => ({
          id: String(hit.id),
          score: hit.score,
          url: hit.payload.url,
          title: hit.payload.title,
        })),
        durationMs: Date.now() - startedAt,
      });
      if (hits.length > 0 && content.trim().length > 0) {
        blocks.push(`Query: ${query}\n${content.trim()}`);
        for (const hit of hits) {
          if (!pooledHits.has(String(hit.id))) pooledHits.set(String(hit.id), hit);
        }
      }
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      span.setAttribute(GEN_AI.RETRIEVAL_RESULT_COUNT, 0);
      span.recordException(error instanceof Error ? error : new Error(errorMessage));
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      emitLogEvent(deps.logger, {
        type: "retrieval",
        agent: "rag-agent",
        requestId,
        query,
        resultCount: 0,
        durationMs: Date.now() - startedAt,
        error: { code: "tool_error", message: errorMessage },
      });
    } finally {
      span.end();
    }
  }

  return { merged: blocks.join(BLOCK_SEPARATOR), hits: [...pooledHits.values()] };
}

async function rerankContext(
  userMessage: string,
  outcome: FetchOutcome,
  deps: RetrievalDeps,
): Promise<string | null> {
  const reranker = deps.reranker!;
  const span = tracer.startSpan("rag-agent.rerank", {
    attributes: {
      "rerank.provider": reranker.provider,
      "rerank.model": reranker.model,
      "rerank.candidate_count": outcome.hits.length,
    },
  });
  try {
    const hitById = new Map(outcome.hits.map((hit) => [String(hit.id), hit]));
    const results = await reranker.rerank(
      userMessage,
      outcome.hits.map((hit) => ({ id: String(hit.id), content: hit.payload.content })),
      deps.rerankTopN,
    );
    // Keep only results above threshold whose id is still in the candidate pool;
    // a reranker returning an unknown id is skipped rather than throwing.
    const kept = results.filter(
      (result) => result.score >= deps.rerankThreshold && hitById.has(result.id),
    );
    span.setAttribute("rerank.result_count", kept.length);
    span.setStatus({ code: SpanStatusCode.OK });
    if (kept.length === 0) return null;
    return kept
      .map((result, index) => formatHit(hitById.get(result.id)!, index, result.score))
      .join(BLOCK_SEPARATOR);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    span.recordException(error instanceof Error ? error : new Error(errorMessage));
    span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
    deps.logger.warn(
      { err: error },
      `Reranking failed (${errorMessage}) — using unreranked retrieval context`,
    );
    return outcome.merged;
  } finally {
    span.end();
  }
}
