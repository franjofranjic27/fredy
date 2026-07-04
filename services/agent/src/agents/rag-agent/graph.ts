import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import {
  contentToString,
  providerForModel,
  type AgentUsage,
  type ChatMessage,
  type Logger,
} from "@fredy/agent-core";
import { emitLogEvent } from "../../observability/log-events.js";
import { rewriteQuery } from "./query-rewrite.js";
import { retrieveContext, type RetrievalDeps } from "./retrieval.js";
import { fallbackResponseFor, RAG_SYSTEM_PROMPT } from "./system-prompt.js";
import { trimHistoryToBudget, trimToTokenBudget } from "./token-utils.js";

export interface CreateModelOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface RagGraphDeps {
  readonly retrieval: RetrievalDeps;
  readonly createModel: (options: CreateModelOptions) => BaseChatModel;
  readonly tokenBudget: number;
  readonly historyTokenBudget: number;
  /** Condense follow-up questions into standalone retrieval queries via a cheap LLM call. */
  readonly queryRewrite: boolean;
  readonly fallbackModel: string;
  readonly logger: Logger;
}

const RagStateAnnotation = Annotation.Root({
  sessionId: Annotation<string>,
  requestId: Annotation<string>,
  messages: Annotation<readonly ChatMessage[]>,
  userMessage: Annotation<string>,
  allowedToolNames: Annotation<readonly string[] | undefined>,
  temperature: Annotation<number | undefined>,
  maxTokens: Annotation<number | undefined>,
  startedAt: Annotation<number>,
  /** The (possibly history-rewritten) query used for retrieval and reranking. */
  retrievalQuery: Annotation<string | undefined>,
  context: Annotation<string | null>,
  answer: Annotation<string>,
  usage: Annotation<AgentUsage | undefined>,
  responseModel: Annotation<string | undefined>,
});

export type RagState = typeof RagStateAnnotation.State;

function toLangChainHistory(messages: readonly ChatMessage[], userMessage: string): BaseMessage[] {
  const history: BaseMessage[] = messages
    .filter((message) => message.role !== "system")
    .map((message) =>
      message.role === "user" ? new HumanMessage(message.content) : new AIMessage(message.content),
    );
  const last = history[history.length - 1];
  const lastIsLatestUser =
    last !== undefined &&
    last.getType() === "human" &&
    contentToString(last.content) === userMessage;
  if (!lastIsLatestUser) {
    history.push(new HumanMessage(userMessage));
  }
  return history;
}

function llmSystemFor(model: string): "anthropic" | "openai" | "google.gemini" {
  switch (providerForModel(model)) {
    case "openai":
      return "openai";
    case "gemini":
      return "google.gemini";
    default:
      return "anthropic";
  }
}

function extractUsage(message: AIMessage): AgentUsage | undefined {
  const usage = message.usage_metadata;
  if (!usage) return undefined;
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
}

function extractResponseModel(message: AIMessage): string | undefined {
  const metadata = message.response_metadata as Record<string, unknown> | undefined;
  const model = metadata?.model ?? metadata?.model_name;
  return typeof model === "string" ? model : undefined;
}

/**
 * Deterministic RAG pipeline as a LangGraph state machine:
 * retrieve → (context null → refuse | generate). Each node is swappable
 * without touching the HTTP layer or the agent contract.
 */
export function buildRagGraph(deps: RagGraphDeps) {
  const retrieve = async (state: RagState, config: RunnableConfig): Promise<Partial<RagState>> => {
    let retrievalQuery = state.userMessage;
    if (deps.queryRewrite) {
      retrievalQuery = await rewriteQuery(
        state.userMessage,
        state.messages,
        { createModel: deps.createModel, logger: deps.logger },
        config,
      );
      if (retrievalQuery !== state.userMessage) {
        deps.logger.debug(
          { original: state.userMessage, rewritten: retrievalQuery },
          "Query rewritten for retrieval",
        );
      }
    }
    const context = await retrieveContext(
      retrievalQuery,
      { requestId: state.requestId, allowedToolNames: state.allowedToolNames },
      deps.retrieval,
    );
    return { context, retrievalQuery };
  };

  const refuse = (state: RagState): Partial<RagState> => {
    emitLogEvent(deps.logger, {
      type: "request",
      agent: "rag-agent",
      sessionId: state.sessionId,
      requestId: state.requestId,
      model: deps.fallbackModel,
      durationMs: Date.now() - state.startedAt,
      finishReason: "fallback",
    });
    return { answer: fallbackResponseFor(state.userMessage), responseModel: deps.fallbackModel };
  };

  const generate = async (state: RagState, config: RunnableConfig): Promise<Partial<RagState>> => {
    const trimmedContext = trimToTokenBudget(state.context ?? "", deps.tokenBudget);
    const system = `${RAG_SYSTEM_PROMPT}\n\nContext:\n${trimmedContext}`;
    const model = deps.createModel({
      temperature: state.temperature,
      maxTokens: state.maxTokens,
    });

    const history = trimHistoryToBudget(
      toLangChainHistory(state.messages, state.userMessage).map((message) => ({
        message,
        content: contentToString(message.content),
      })),
      deps.historyTokenBudget,
    ).map((entry) => entry.message);

    const response = await model.invoke([new SystemMessage(system), ...history], config);

    const usage = extractUsage(response);
    const responseModel = extractResponseModel(response) ?? deps.fallbackModel;
    const durationMs = Date.now() - state.startedAt;
    emitLogEvent(deps.logger, {
      type: "request",
      agent: "rag-agent",
      sessionId: state.sessionId,
      requestId: state.requestId,
      model: responseModel,
      durationMs,
      finishReason: "stop",
    });
    if (usage) {
      emitLogEvent(deps.logger, {
        type: "llm-call",
        agent: "rag-agent",
        sessionId: state.sessionId,
        requestId: state.requestId,
        provider: llmSystemFor(deps.fallbackModel),
        model: responseModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs,
      });
    }

    return {
      answer: contentToString(response.content),
      usage,
      responseModel,
    };
  };

  return new StateGraph(RagStateAnnotation)
    .addNode("retrieve", retrieve)
    .addNode("refuse", refuse)
    .addNode("generate", generate)
    .addEdge(START, "retrieve")
    .addConditionalEdges("retrieve", (state) => (state.context === null ? "refuse" : "generate"), [
      "refuse",
      "generate",
    ])
    .addEdge("refuse", END)
    .addEdge("generate", END)
    .compile();
}
