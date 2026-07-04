import { describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../testing/test-logger.js";
import { FakeJiraClient, makeIssue } from "../testing/fake-jira-client.js";
import type { TicketCacheStore } from "../cache/ticket-cache.js";
import type { TransitionIntent } from "../agent/types.js";
import { AutoApproveGate, type ActionGate } from "./action-gate.js";
import { ACTION_META, type JiraAction } from "./actions.js";
import { createActionExecutor } from "./executor.js";

const TRANSITIONS: Record<TransitionIntent, string> = {
  resolve: "Done",
  "waiting-for-reporter": "Waiting for customer",
};

function makeCache() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    recordHit: vi.fn().mockResolvedValue(undefined),
  };
}

function makeExecutor(overrides: { gate?: ActionGate; cache?: ReturnType<typeof makeCache> } = {}) {
  const client = new FakeJiraClient();
  client.issues.set("IT-1", makeIssue());
  client.transitions = [
    { id: "31", name: "done" },
    { id: "41", name: "Waiting for customer" },
  ];
  const cache = overrides.cache ?? makeCache();
  const captured = createTestLogger();
  const executor = createActionExecutor({
    client,
    gate: overrides.gate ?? new AutoApproveGate(),
    cache: cache as unknown as TicketCacheStore,
    transitionNames: TRANSITIONS,
    logger: captured.logger,
  });
  return { executor, client, cache, captured };
}

const CACHE_WRITE = {
  ticketKey: "IT-1",
  projectKey: "IT",
  questionText: "q",
  resolutionText: "r",
  embedding: [0.1],
};

describe("action executor", () => {
  it("applies actions in order and returns their descriptions", async () => {
    const { executor, client } = makeExecutor();
    const applied = await executor.apply({
      issueKey: "IT-1",
      requestId: "r1",
      actions: [
        { type: "addComment", markdown: "Hello **there**" },
        { type: "transition", intent: "resolve" },
        { type: "assignIssue", accountId: "reporter-1" },
      ],
    });
    expect(applied).toEqual(["addComment", "transition:resolve", "assignIssue:reporter-1"]);
    const methods = client.calls.map((call) => call.method);
    expect(methods).toEqual(["addComment", "getTransitions", "transitionIssue", "assignIssue"]);
  });

  it("resolves transition names case-insensitively", async () => {
    const { executor, client } = makeExecutor();
    await executor.apply({
      issueKey: "IT-1",
      requestId: "r1",
      actions: [{ type: "transition", intent: "resolve" }],
    });
    expect(client.callsOf("transitionIssue")[0]?.args).toEqual(["IT-1", "31"]);
  });

  it("skips (does not fail) when the transition name is missing on the workflow", async () => {
    const { executor, client, captured } = makeExecutor();
    client.transitions = [{ id: "1", name: "Some other status" }];
    const applied = await executor.apply({
      issueKey: "IT-1",
      requestId: "r1",
      actions: [
        { type: "addComment", markdown: "hi" },
        { type: "transition", intent: "resolve" },
      ],
    });
    expect(applied).toEqual(["addComment"]);
    expect(client.callsOf("transitionIssue")).toHaveLength(0);
    expect(captured.warn).toHaveBeenCalled();
  });

  it("stops mid-sequence on failure and skips the cache write", async () => {
    const { executor, client, cache } = makeExecutor();
    client.failOn = { method: "transitionIssue", error: new Error("boom") };
    await expect(
      executor.apply({
        issueKey: "IT-1",
        requestId: "r1",
        actions: [
          { type: "addComment", markdown: "hi" },
          { type: "transition", intent: "resolve" },
          { type: "assignIssue", accountId: null },
        ],
        cacheWrite: CACHE_WRITE,
      }),
    ).rejects.toThrow("boom");
    expect(client.callsOf("assignIssue")).toHaveLength(0);
    expect(cache.upsert).not.toHaveBeenCalled();
  });

  it("writes the cache entry and records hits after full success", async () => {
    const { executor, cache } = makeExecutor();
    await executor.apply({
      issueKey: "IT-1",
      requestId: "r1",
      actions: [{ type: "addComment", markdown: "hi" }],
      cacheWrite: CACHE_WRITE,
      recordHitFor: "IT-99",
    });
    expect(cache.upsert).toHaveBeenCalledWith(CACHE_WRITE);
    expect(cache.recordHit).toHaveBeenCalledWith("IT-99");
  });

  it("converts markdown comments to ADF", async () => {
    const { executor, client } = makeExecutor();
    await executor.apply({
      issueKey: "IT-1",
      requestId: "r1",
      actions: [{ type: "addComment", markdown: "- item one\n- item two" }],
    });
    const [, body] = client.callsOf("addComment")[0].args as [string, { content: unknown[] }];
    expect((body.content[0] as { type: string }).type).toBe("bulletList");
  });

  it("rejects actions the gate denies", async () => {
    const denyingGate: ActionGate = {
      approve: async () => {
        throw new Error("denied by gate");
      },
    };
    const { executor, client } = makeExecutor({ gate: denyingGate });
    await expect(
      executor.apply({
        issueKey: "IT-1",
        requestId: "r1",
        actions: [{ type: "addComment", markdown: "hi" }],
      }),
    ).rejects.toThrow("denied by gate");
    expect(client.callsOf("addComment")).toHaveLength(0);
  });
});

describe("action metadata", () => {
  it("classifies every v1 action as side-effecting and jira-internal", () => {
    for (const meta of Object.values(ACTION_META)) {
      expect(meta.readOnly).toBe(false);
      expect(meta.blastRadius).toBe("jira-internal");
    }
  });

  it("auto-approves jira-internal actions", async () => {
    const gate = new AutoApproveGate();
    const action: JiraAction = { type: "addComment", markdown: "x" };
    await expect(gate.approve(action, { issueKey: "IT-1" })).resolves.toBeUndefined();
  });
});
