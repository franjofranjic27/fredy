import { randomUUID } from "node:crypto";
import { context as otelContext, trace, SpanStatusCode } from "@opentelemetry/api";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AGENT,
  contentToString,
  OtelCallbackHandler,
  resolveChatModel,
  type AgentDefinition,
  type AgentRun,
  type AgentRunInput,
  type AgentRunResult,
  type AgentStreamEvent,
  type AgentUsage,
  type Logger,
  type ToolRegistry,
} from "@fredy/agent-core";
import type { AppConfig } from "../../config.js";
import type { Reranker } from "../../rerank/reranker.js";
import { buildRagGraph, type CreateModelOptions, type RagState } from "./graph.js";

export const RAG_AGENT_ID = "rag-agent";

/** Minimal shape of the LangGraph streamEvents events the SSE mapping consumes. */
export interface RagStreamEvent {
  readonly event: string;
  readonly name?: string;
  readonly metadata?: { readonly langgraph_node?: string };
  readonly data?: {
    readonly chunk?: { readonly content?: unknown };
    readonly output?: {
      readonly answer?: string;
      readonly usage?: AgentUsage;
      readonly responseModel?: string;
    };
  };
}

/**
 * Maps LangGraph stream events to the AgentStreamEvents sent over SSE.
 *
 * Only tokens emitted inside the "generate" node are forwarded — the graph may
 * run other LLM calls (query rewrite in "retrieve") whose tokens must never
 * reach the client. Streamed tokens set a guard so the terminal
 * on_chain_end("generate") whole-answer emission is suppressed — otherwise
 * streaming providers would emit the answer twice; it only fires for providers
 * that don't stream tokens. The refuse node emits its language-matched
 * fallback answer. A single terminal `done` event carries usage/model.
 */
export async function* mapRagStreamEvents(
  events: AsyncIterable<RagStreamEvent>,
): AsyncGenerator<AgentStreamEvent> {
  let streamedTokens = false;
  let usage: AgentUsage | undefined;
  let model: string | undefined;
  for await (const event of events) {
    if (event.event === "on_chat_model_stream") {
      if (event.metadata?.langgraph_node !== "generate") continue;
      const text = contentToString(event.data?.chunk?.content);
      if (text) {
        streamedTokens = true;
        yield { type: "delta", text };
      }
    } else if (event.event === "on_chain_end" && event.name === "refuse") {
      const answer = event.data?.output?.answer;
      if (answer) yield { type: "delta", text: answer };
      model = event.data?.output?.responseModel ?? model;
    } else if (event.event === "on_chain_end" && event.name === "generate") {
      usage = event.data?.output?.usage ?? usage;
      model = event.data?.output?.responseModel ?? model;
      const answer = event.data?.output?.answer;
      if (!streamedTokens && answer) yield { type: "delta", text: answer };
    }
  }
  yield { type: "done", usage, model };
}

/**
 * Pulls each event with the given span context active, so LLM/tool spans created
 * by the callback handler parent under the streaming agent.run span (mirroring
 * how invoke() wraps graph.invoke in the same context).
 */
async function* withActiveSpanContext<T>(
  events: AsyncIterable<T>,
  spanContext: ReturnType<typeof trace.setSpan>,
): AsyncGenerator<T> {
  const iterator = events[Symbol.asyncIterator]();
  for (;;) {
    const { value, done } = await otelContext.with(spanContext, () => iterator.next());
    if (done) return;
    yield value;
  }
}

export interface RagAgentDeps {
  readonly config: AppConfig;
  readonly toolRegistry: ToolRegistry;
  readonly reranker: Reranker | null;
  readonly logger: Logger;
  /** Test seam: overrides the LangChain chat model factory. */
  readonly createModel?: (options: CreateModelOptions) => BaseChatModel;
}

const tracer = trace.getTracer("fredy-agent");

function initialState(input: AgentRunInput, requestId: string): RagState {
  return {
    sessionId: input.sessionId,
    requestId,
    messages: input.messages,
    userMessage: input.userMessage,
    allowedToolNames: input.allowedToolNames,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    startedAt: Date.now(),
    retrievalQuery: undefined,
    context: null,
    answer: "",
    usage: undefined,
    responseModel: undefined,
  };
}

/**
 * RAG agent on the shared agent-core base: deterministic LangGraph pipeline
 * (retrieve → generate | refuse) grounded in pgvector content.
 */
export function createRagAgent(): AgentDefinition<RagAgentDeps> {
  return {
    id: RAG_AGENT_ID,
    ownedBy: "fredy",
    createRun(deps: RagAgentDeps): AgentRun {
      const { config } = deps;
      const createModel =
        deps.createModel ??
        ((options: CreateModelOptions) =>
          resolveChatModel(config.llm.fallbackModel, {
            fallbackModel: config.llm.fallbackModel,
            anthropic: config.llm.anthropic,
            openai: config.llm.openai,
            gemini: config.llm.gemini,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            logger: deps.logger,
          }));

      const graph = buildRagGraph({
        retrieval: {
          toolRegistry: deps.toolRegistry,
          reranker: deps.reranker,
          rerankTopN: config.rerank.topN,
          rerankThreshold: config.rerank.threshold,
          defaultLimit: config.retrieval.defaultLimit,
          logger: deps.logger,
        },
        createModel,
        tokenBudget: config.retrieval.tokenBudget,
        historyTokenBudget: config.retrieval.historyTokenBudget,
        queryRewrite: config.retrieval.queryRewrite,
        fallbackModel: config.llm.fallbackModel,
        logger: deps.logger,
      });
      const otelCallback = new OtelCallbackHandler();

      return {
        async invoke(input: AgentRunInput): Promise<AgentRunResult> {
          const requestId = `${input.sessionId}-${randomUUID()}`;
          const span = tracer.startSpan("agent.run", {
            attributes: { [AGENT.NAME]: RAG_AGENT_ID, [AGENT.SESSION_ID]: input.sessionId },
          });
          try {
            const finalState = await otelContext.with(
              trace.setSpan(otelContext.active(), span),
              () =>
                graph.invoke(initialState(input, requestId), {
                  callbacks: [otelCallback],
                  runName: RAG_AGENT_ID,
                  signal: input.signal,
                }),
            );
            span.setStatus({ code: SpanStatusCode.OK });
            return {
              content: finalState.answer,
              model: finalState.responseModel ?? config.llm.fallbackModel,
              usage: finalState.usage,
            };
          } catch (error) {
            span.recordException(error instanceof Error ? error : new Error(String(error)));
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },

        async *stream(input: AgentRunInput): AsyncIterable<AgentStreamEvent> {
          const requestId = `${input.sessionId}-${randomUUID()}`;
          const span = tracer.startSpan("agent.run", {
            attributes: { [AGENT.NAME]: RAG_AGENT_ID, [AGENT.SESSION_ID]: input.sessionId },
          });
          const spanContext = trace.setSpan(otelContext.active(), span);
          try {
            const events = graph.streamEvents(initialState(input, requestId), {
              version: "v2",
              callbacks: [otelCallback],
              runName: `${RAG_AGENT_ID}-${randomUUID()}`,
              signal: input.signal,
            }) as AsyncIterable<RagStreamEvent>;
            yield* mapRagStreamEvents(withActiveSpanContext(events, spanContext));
            span.setStatus({ code: SpanStatusCode.OK });
          } catch (error) {
            span.recordException(error instanceof Error ? error : new Error(String(error)));
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            // On early break/return/throw (e.g. SSE disconnect) end any spans the
            // callback handler still holds so they never leak.
            otelCallback.endOpenSpans();
            span.end();
          }
        },
      };
    },
  };
}
