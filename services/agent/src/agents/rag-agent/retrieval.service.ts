import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { trace, Tracer } from "@opentelemetry/api";
import { ObservabilityService } from "../../shared/observability/observability.service";
import { GEN_AI } from "../../shared/observability/semconv";
import { ToolExecutorService } from "../../shared/tools/tool-executor.service";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { QueryRewriteService } from "./query-rewrite.service";

const VECTOR_SEARCH_TOOL = "vector_search";

export interface RetrievalOptions {
  requestId: string;
  allowedToolNames?: string[];
  spaceKey?: string;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly tracer: Tracer = trace.getTracer("fredy-agent.retrieval");
  private readonly defaultLimit: number;

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly observability: ObservabilityService,
    private readonly queryRewrite: QueryRewriteService,
    config: ConfigService,
  ) {
    this.defaultLimit = config.get<number>("retrieval.defaultLimit") ?? 5;
  }

  /**
   * Always returns the merged context block from vector_search, or null if
   * the tool is unavailable or yields no results. Never falls back to the LLM
   * alone — the deterministic flow requires retrieval to ground every answer.
   */
  async getContext(userMessage: string, options: RetrievalOptions): Promise<string | null> {
    const { requestId, allowedToolNames, spaceKey } = options;
    if (!this.isToolAvailable(allowedToolNames)) {
      this.logger.warn("vector_search unavailable for this request — refusing to answer");
      this.observability.log({
        type: "retrieval",
        agent: "rag-agent",
        requestId,
        query: userMessage.trim() || "empty",
        resultCount: 0,
      });
      return null;
    }

    const queries = this.queryRewrite.rewrite(userMessage);
    const effective = queries.length > 0 ? queries : [userMessage.trim()].filter(Boolean);
    if (effective.length === 0) return null;

    const merged = await this.fetchContext(effective, requestId, spaceKey);
    if (merged.trim().length > 0) return merged;

    if (effective.length > 1) {
      const retry = await this.fetchContext(
        [userMessage.trim()].filter(Boolean),
        requestId,
        spaceKey,
      );
      return retry.trim().length > 0 ? retry : null;
    }

    return null;
  }

  private isToolAvailable(allowed?: string[]): boolean {
    if (!this.toolRegistry.hasTool(VECTOR_SEARCH_TOOL)) return false;
    if (!allowed) return true;
    return allowed.includes(VECTOR_SEARCH_TOOL);
  }

  private async fetchContext(
    queries: string[],
    requestId: string,
    spaceKey?: string,
  ): Promise<string> {
    const blocks: string[] = [];
    for (const query of queries) {
      const span = this.observability.startSpan("retrieval", requestId, "rag-agent");
      span.setAttribute(GEN_AI.RETRIEVAL_QUERY, query);
      const startedAt = Date.now();
      try {
        const outcome = await this.toolExecutor.run<{ hits: unknown[] }>(
          VECTOR_SEARCH_TOOL,
          { query, limit: this.defaultLimit, spaceKey },
          { requestId, agentId: "rag-agent" },
        );
        const durationMs = Date.now() - startedAt;
        if (!outcome.ok) {
          span.setAttribute(GEN_AI.RETRIEVAL_RESULT_COUNT, 0);
          this.observability.log({
            type: "retrieval",
            agent: "rag-agent",
            requestId,
            query,
            resultCount: 0,
            durationMs,
            error: { code: outcome.error.code, message: outcome.error.message },
          });
          continue;
        }
        const chunks = outcome.result.metadata?.chunks ?? [];
        span.setAttribute(GEN_AI.RETRIEVAL_RESULT_COUNT, chunks.length);
        this.observability.log({
          type: "retrieval",
          agent: "rag-agent",
          requestId,
          query,
          resultCount: chunks.length,
          chunks,
          durationMs,
        });
        if (outcome.result.output?.trim().length > 0) {
          blocks.push(`Query: ${query}\n${outcome.result.output.trim()}`);
        }
      } finally {
        span.end();
      }
    }

    return blocks.join("\n\n---\n\n");
  }
}
