import { describe, expect, it, vi } from "vitest";
import { tool } from "@langchain/core/tools";
import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ToolRegistry } from "@fredy/agent-core";
import { buildRagGraph, type RagGraphDeps, type RagState } from "./graph.js";
import { RAG_FALLBACK_RESPONSE, RAG_SYSTEM_PROMPT } from "./system-prompt.js";
import type { VectorSearchHit } from "../../tools/pgvector.js";
import { FakeChatModel } from "../../testing/fake-chat-model.js";
import { createTestLogger } from "../../testing/test-logger.js";

function registryWithVectorSearch(content: string, hits: VectorSearchHit[]): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    tool(async (): Promise<[string, { hits: VectorSearchHit[] }]> => [content, { hits }], {
      name: "vector_search",
      description: "stub",
      schema: z.object({
        query: z.string(),
        limit: z.number().optional(),
        spaceKey: z.string().optional(),
      }),
      responseFormat: "content_and_artifact",
    }),
  );
  return registry;
}

function initialState(overrides: Partial<RagState> = {}): RagState {
  return {
    sessionId: "s1",
    requestId: "s1-1",
    messages: [{ role: "user", content: "How do I set up VPN access" }],
    userMessage: "How do I set up VPN access",
    allowedToolNames: undefined,
    temperature: undefined,
    maxTokens: undefined,
    startedAt: Date.now(),
    retrievalQuery: undefined,
    context: null,
    answer: "",
    usage: undefined,
    responseModel: undefined,
    ...overrides,
  };
}

function makeDeps(
  registry: ToolRegistry,
  model: FakeChatModel,
  overrides: Partial<RagGraphDeps> = {},
): { deps: RagGraphDeps; createModel: ReturnType<typeof vi.fn> } {
  const createModel = vi.fn().mockReturnValue(model);
  return {
    deps: {
      retrieval: {
        toolRegistry: registry,
        reranker: null,
        rerankTopN: 10,
        rerankThreshold: 0,
        defaultLimit: 5,
        logger: createTestLogger().logger,
      },
      createModel,
      tokenBudget: 3200,
      historyTokenBudget: 4000,
      queryRewrite: false,
      fallbackModel: "claude-sonnet-4-5-20250929",
      logger: createTestLogger().logger,
      ...overrides,
    },
    createModel,
  };
}

const hit: VectorSearchHit = {
  id: "1",
  score: 0.9,
  payload: { title: "VPN", content: "Install Cisco AnyConnect", url: "https://wiki/vpn" },
};

describe("rag graph", () => {
  it("routes to refuse with the verbatim fallback when retrieval yields nothing", async () => {
    const model = new FakeChatModel({ response: "should not be called" });
    const { deps, createModel } = makeDeps(new ToolRegistry(), model);
    const graph = buildRagGraph(deps);
    const result = await graph.invoke(initialState());
    expect(result.answer).toBe(
      "I'm sorry, I don't know the answer to that question. The relevant documentation may not be indexed in the knowledge base, or my access to it was restricted.",
    );
    expect(result.answer).toBe(RAG_FALLBACK_RESPONSE);
    expect(createModel).not.toHaveBeenCalled();
  });

  it("routes to refuse when vector_search is denied via allowedToolNames", async () => {
    const registry = registryWithVectorSearch("docs", [hit]);
    const model = new FakeChatModel({ response: "grounded answer" });
    const { deps } = makeDeps(registry, model);
    const graph = buildRagGraph(deps);
    const result = await graph.invoke(initialState({ allowedToolNames: [] }));
    expect(result.answer).toBe(RAG_FALLBACK_RESPONSE);
  });

  it("generates from the retrieved context with the verbatim system prompt", async () => {
    const registry = registryWithVectorSearch("VPN docs body", [hit]);
    const model = new FakeChatModel({
      response: "grounded answer",
      usage: { input_tokens: 120, output_tokens: 22, total_tokens: 142 },
      modelName: "claude-sonnet-4-5-20250929",
    });
    const { deps } = makeDeps(registry, model);
    const graph = buildRagGraph(deps);
    const result = await graph.invoke(initialState());

    expect(result.answer).toBe("grounded answer");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 22 });
    expect(result.responseModel).toBe("claude-sonnet-4-5-20250929");

    const messages = model.receivedMessages[0];
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    const system = String(messages[0].content);
    expect(system.startsWith(RAG_SYSTEM_PROMPT)).toBe(true);
    expect(system).toContain("\n\nContext:\n");
    expect(system).toContain("VPN docs body");
    expect(messages[messages.length - 1].content).toBe("How do I set up VPN access");
  });

  it("trims the context to the token budget before prompting", async () => {
    const longContext = "x".repeat(10_000);
    const registry = registryWithVectorSearch(longContext, [hit]);
    const model = new FakeChatModel({ response: "ok" });
    const { deps } = makeDeps(registry, model, undefined);
    const graph = buildRagGraph({ ...deps, tokenBudget: 10 }); // 40 chars
    await graph.invoke(initialState());
    const system = String(model.receivedMessages[0][0].content);
    expect(system).toContain("...[truncated]");
    expect(system).not.toContain("x".repeat(60));
  });

  it("filters system messages from the request history and keeps the dialogue", async () => {
    const registry = registryWithVectorSearch("docs", [hit]);
    const model = new FakeChatModel({ response: "ok" });
    const { deps } = makeDeps(registry, model);
    const graph = buildRagGraph(deps);
    await graph.invoke(
      initialState({
        messages: [
          { role: "system", content: "client-side prompt to drop" },
          { role: "user", content: "earlier question" },
          { role: "assistant", content: "earlier answer" },
          { role: "user", content: "How do I set up VPN access" },
        ],
      }),
    );
    const messages = model.receivedMessages[0];
    const contents = messages.map((message) => String(message.content));
    expect(contents).toEqual([
      expect.stringContaining(RAG_SYSTEM_PROMPT),
      "earlier question",
      "earlier answer",
      "How do I set up VPN access",
    ]);
  });

  it("forwards temperature and max_tokens to the model factory", async () => {
    const registry = registryWithVectorSearch("docs", [hit]);
    const model = new FakeChatModel({ response: "ok" });
    const { deps, createModel } = makeDeps(registry, model);
    const graph = buildRagGraph(deps);
    await graph.invoke(initialState({ temperature: 0.4, maxTokens: 256 }));
    expect(createModel).toHaveBeenCalledWith({ temperature: 0.4, maxTokens: 256 });
  });

  it("responds with a German refusal to a German question", async () => {
    const model = new FakeChatModel({ response: "unused" });
    const { deps } = makeDeps(new ToolRegistry(), model);
    const graph = buildRagGraph(deps);
    const result = await graph.invoke(
      initialState({
        messages: [{ role: "user", content: "Wie richte ich das VPN ein?" }],
        userMessage: "Wie richte ich das VPN ein?",
      }),
    );
    expect(result.answer).toMatch(/^Es tut mir leid/);
  });

  it("retrieves with the rewritten query when queryRewrite is enabled and history exists", async () => {
    const seenQueries: string[] = [];
    const registry = new ToolRegistry();
    registry.register(
      tool(
        async (input: { query: string }): Promise<[string, { hits: VectorSearchHit[] }]> => {
          seenQueries.push(input.query);
          return ["docs", { hits: [hit] }];
        },
        {
          name: "vector_search",
          description: "stub",
          schema: z.object({
            query: z.string(),
            limit: z.number().optional(),
            spaceKey: z.string().optional(),
          }),
          responseFormat: "content_and_artifact",
        },
      ),
    );
    // The same fake model serves the rewrite and the generate call.
    const model = new FakeChatModel({ response: "VPN setup on cluster B" });
    const { deps } = makeDeps(registry, model, { queryRewrite: true });
    const graph = buildRagGraph(deps);
    await graph.invoke(
      initialState({
        messages: [
          { role: "user", content: "How do I set up VPN access" },
          { role: "assistant", content: "Like this ..." },
          { role: "user", content: "and on cluster B?" },
        ],
        userMessage: "and on cluster B?",
      }),
    );
    expect(seenQueries).toContain("VPN setup on cluster B");
    expect(seenQueries).not.toContain("and on cluster B?");
  });

  it("keeps only the most recent history within the history token budget", async () => {
    const registry = registryWithVectorSearch("docs", [hit]);
    const model = new FakeChatModel({ response: "ok" });
    const { deps } = makeDeps(registry, model, { historyTokenBudget: 20 }); // ~80 chars
    const graph = buildRagGraph(deps);
    await graph.invoke(
      initialState({
        messages: [
          { role: "user", content: "a".repeat(200) },
          { role: "assistant", content: "b".repeat(200) },
          { role: "user", content: "How do I set up VPN access" },
        ],
      }),
    );
    const contents = model.receivedMessages[0].map((message) => String(message.content));
    // System prompt + only the latest user message survive the budget.
    expect(contents).toHaveLength(2);
    expect(contents[1]).toBe("How do I set up VPN access");
  });
});
