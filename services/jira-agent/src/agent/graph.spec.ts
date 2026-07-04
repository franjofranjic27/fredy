import { describe, expect, it, vi } from "vitest";
import type { VectorSearchHit } from "@fredy/agent-core";
import { createTestLogger } from "../testing/test-logger.js";
import { FakeJiraClient, makeIssue } from "../testing/fake-jira-client.js";
import { FakeChatModel } from "../testing/fake-chat-model.js";
import { createQueuedInvokeStructured } from "../testing/fake-structured-model.js";
import { createAccessRequestHandler } from "../handlers/access-request-handler.js";
import { TicketHandlerRegistry } from "../handlers/handler.js";
import type { CacheHit, TicketCacheStore } from "../cache/ticket-cache.js";
import type { EmbeddingClient, PgVectorStore } from "@fredy/agent-core";
import type { JiraComment, JiraIssue } from "../jira/types.js";
import { AutoApproveGate } from "../actions/action-gate.js";
import { createActionExecutor } from "../actions/executor.js";
import { createTriageTicketAgent } from "./ticket-processor.js";
import { CLARIFICATION_MARKER } from "./prompts/clarification.js";

interface SetupOptions {
  issue?: Partial<JiraIssue>;
  comments?: JiraComment[];
  cacheHits?: CacheHit[];
  chunkHits?: VectorSearchHit[];
  classifications?: unknown[];
  answerText?: string;
  registerHandlers?: boolean;
}

function agentComment(id: string, body: string): JiraComment {
  return {
    id,
    author: { accountId: "agent-1", displayName: "Fredy" },
    body,
    created: "2026-01-01T10:00:00.000+0000",
  };
}

function chunkHit(content: string, url = "https://wiki/vpn"): VectorSearchHit {
  return { id: "c1", score: 0.9, payload: { title: "VPN Guide", content, url } };
}

function setup(options: SetupOptions = {}) {
  const client = new FakeJiraClient();
  client.issues.set("IT-1", makeIssue({ issueType: "Task", ...options.issue }));
  client.comments.set("IT-1", options.comments ?? []);
  client.transitions = [
    { id: "31", name: "Done" },
    { id: "41", name: "Waiting for customer" },
  ];

  const cache = {
    lookup: vi.fn().mockResolvedValue(options.cacheHits ?? []),
    upsert: vi.fn().mockResolvedValue(undefined),
    recordHit: vi.fn().mockResolvedValue(undefined),
  };
  const chunks = { search: vi.fn().mockResolvedValue(options.chunkHits ?? []) };
  const embeddings = {
    provider: "openai",
    model: "m",
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
    embedDocument: vi.fn().mockResolvedValue([0.1, 0.2]),
  };
  const handlers = new TicketHandlerRegistry();
  if (options.registerHandlers) handlers.register(createAccessRequestHandler());
  const structured = createQueuedInvokeStructured(options.classifications ?? []);
  const model = new FakeChatModel({
    response: options.answerText ?? "Composed answer.",
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
  });
  const logger = createTestLogger().logger;

  const executor = createActionExecutor({
    client,
    gate: new AutoApproveGate(),
    cache: cache as unknown as TicketCacheStore,
    transitionNames: { resolve: "Done", "waiting-for-reporter": "Waiting for customer" },
    logger,
  });
  const agent = createTriageTicketAgent({
    graphDeps: {
      client,
      embeddings: embeddings as unknown as EmbeddingClient,
      cache: cache as unknown as TicketCacheStore,
      chunks: chunks as unknown as PgVectorStore,
      handlers,
      createModel: () => model,
      invokeStructured: structured.invokeStructured,
      projectKey: "IT",
      agentAccountId: "agent-1",
      retrieval: { defaultLimit: 5, scoreThreshold: 0.7 },
      logger,
    },
    executor,
  });
  return { agent, client, cache, chunks, embeddings, structured, model };
}

function classification(overrides: Record<string, unknown> = {}) {
  return {
    path: "answer",
    confidence: 0.9,
    reasoning: "clear",
    language: "de",
    ...overrides,
  };
}

describe("triage graph paths", () => {
  it("short-circuits to a deterministic handler without any LLM call", async () => {
    const { agent, client, structured } = setup({
      issue: { issueType: "Service Request", summary: "Zugriff auf Grafana" },
      registerHandlers: true,
    });
    const outcome = await agent.process({ issueKey: "IT-1", trigger: "assigned" });

    expect(outcome.path).toBe("handler");
    expect(structured.receivedMessages).toHaveLength(0);
    expect(outcome.actionsApplied).toEqual([
      "addComment",
      "transition:waiting-for-reporter",
      "assignIssue:reporter-1",
    ]);
    expect(client.callsOf("transitionIssue")[0]?.args).toEqual(["IT-1", "41"]);
  });

  it("answers directly and writes the cache on a confident answer", async () => {
    const { agent, client, cache } = setup({
      classifications: [classification()],
      answerText: "Bitte VPN-Client neu starten.",
    });
    const outcome = await agent.process({ issueKey: "IT-1", trigger: "assigned" });

    expect(outcome.path).toBe("answered");
    expect(outcome.actionsApplied).toEqual(["addComment", "transition:resolve"]);
    expect(client.callsOf("transitionIssue")[0]?.args).toEqual(["IT-1", "31"]);
    expect(cache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketKey: "IT-1",
        projectKey: "IT",
        resolutionText: "Bitte VPN-Client neu starten.",
      }),
    );
  });

  it("uses the cache path: records the hit, never re-caches", async () => {
    const strongHit: CacheHit = {
      ticketKey: "IT-99",
      question: "VPN broken",
      resolution: "Restart the client",
      score: 0.95,
      strong: true,
    };
    const { agent, cache } = setup({
      cacheHits: [strongHit],
      classifications: [classification({ path: "use_cache" })],
    });
    const outcome = await agent.process({ issueKey: "IT-1", trigger: "assigned" });

    expect(outcome.path).toBe("cached");
    expect(cache.recordHit).toHaveBeenCalledWith("IT-99");
    expect(cache.upsert).not.toHaveBeenCalled();
  });

  it("retrieves context once and then answers", async () => {
    const { agent, chunks, structured } = setup({
      chunkHits: [chunkHit("Restart the VPN client via the tray icon.")],
      classifications: [
        classification({ path: "need_context", retrievalQuery: "vpn restart howto" }),
        classification({ path: "answer" }),
      ],
    });
    const outcome = await agent.process({ issueKey: "IT-1", trigger: "assigned" });

    expect(outcome.path).toBe("answered");
    expect(chunks.search).toHaveBeenCalledTimes(1);
    // Second classify round sees the retrieved context.
    const secondInput = String(structured.receivedMessages[1]?.[1]?.content ?? "");
    expect(secondInput).toContain("Restart the VPN client");
  });

  it("coerces a second need_context into answering (loop guard)", async () => {
    const { agent, chunks } = setup({
      chunkHits: [chunkHit("Some context.")],
      classifications: [
        classification({ path: "need_context" }),
        classification({ path: "need_context" }),
      ],
    });
    const outcome = await agent.process({ issueKey: "IT-1", trigger: "assigned" });

    expect(outcome.path).toBe("answered");
    expect(chunks.search).toHaveBeenCalledTimes(1);
  });

  it("asks the reporter and hands the ticket back", async () => {
    const { agent, client } = setup({
      classifications: [
        classification({ path: "ask_reporter", missingInfo: ["Which system?"], confidence: 0.8 }),
      ],
      answerText: "Welche Umgebung betrifft das?",
    });
    const outcome = await agent.process({ issueKey: "IT-1", trigger: "assigned" });

    expect(outcome.path).toBe("clarification");
    expect(outcome.actionsApplied).toEqual([
      "addComment",
      "transition:waiting-for-reporter",
      "assignIssue:reporter-1",
    ]);
    const [, body] = client.callsOf("addComment")[0].args as [string, unknown];
    expect(JSON.stringify(body)).toContain(CLARIFICATION_MARKER);
  });

  it("escalates after two unanswered clarification rounds without an LLM call", async () => {
    const { agent, client, structured } = setup({
      comments: [
        agentComment("1", `Frage 1\n\n${CLARIFICATION_MARKER}`),
        agentComment("2", `Frage 2\n\n${CLARIFICATION_MARKER}`),
      ],
    });
    const outcome = await agent.process({ issueKey: "IT-1", trigger: "reprocess" });

    expect(outcome.path).toBe("escalated");
    expect(structured.receivedMessages).toHaveLength(0);
    // Escalations only comment — the ticket stays with the agent so a human notices.
    expect(outcome.actionsApplied).toEqual(["addComment"]);
    expect(client.callsOf("assignIssue")).toHaveLength(0);
    expect(client.callsOf("transitionIssue")).toHaveLength(0);
  });

  it("escalates below the confidence floor", async () => {
    const { agent } = setup({
      classifications: [classification({ confidence: 0.2 })],
    });
    const outcome = await agent.process({ issueKey: "IT-1", trigger: "assigned" });
    expect(outcome.path).toBe("escalated");
  });
});
