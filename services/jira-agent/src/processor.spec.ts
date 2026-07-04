import { describe, expect, it, vi } from "vitest";
import { createTicketProcessor } from "./processor.js";
import { FakeJiraClient, makeIssue } from "./testing/fake-jira-client.js";
import { createTestLogger } from "./testing/test-logger.js";
import { LABEL_DONE, LABEL_FAILED, LABEL_IN_PROGRESS } from "./labels.js";
import type { TicketAgent, TicketOutcome } from "./agent/types.js";

const AGENT_ACCOUNT = "agent-1";

function makeAgent(outcome: Partial<TicketOutcome> = {}, error?: Error): TicketAgent {
  return {
    process: vi.fn(async (event) => {
      if (error) throw error;
      return {
        issueKey: event.issueKey,
        path: "answered",
        actionsApplied: ["addComment"],
        ...outcome,
      } as TicketOutcome;
    }),
  };
}

function setup(issueOverrides = {}, agent: TicketAgent = makeAgent()) {
  const client = new FakeJiraClient();
  client.issues.set("IT-1", makeIssue(issueOverrides));
  const logger = createTestLogger();
  const process = createTicketProcessor({
    client,
    agent,
    agentAccountId: AGENT_ACCOUNT,
    logger: logger.logger,
  });
  return { client, process, agent, logger };
}

describe("createTicketProcessor", () => {
  it("claims, processes and marks the ticket done", async () => {
    const { client, process, agent } = setup();
    await process({ issueKey: "IT-1", trigger: "assigned" });

    expect(client.callsOf("addLabel").map((call) => call.args[1])).toEqual([
      LABEL_IN_PROGRESS,
      LABEL_DONE,
    ]);
    expect(client.callsOf("removeLabel").map((call) => call.args[1])).toEqual([LABEL_IN_PROGRESS]);
    expect(agent.process).toHaveBeenCalledOnce();
  });

  it("skips tickets that already carry an agent label", async () => {
    const { client, process, agent } = setup({ labels: [LABEL_DONE] });
    await process({ issueKey: "IT-1", trigger: "assigned" });

    expect(agent.process).not.toHaveBeenCalled();
    expect(client.callsOf("addLabel")).toHaveLength(0);
  });

  it("skips tickets no longer assigned to the agent account", async () => {
    const { client, process, agent } = setup({
      assignee: { accountId: "someone-else", displayName: "X" },
    });
    await process({ issueKey: "IT-1", trigger: "assigned" });

    expect(agent.process).not.toHaveBeenCalled();
    expect(client.callsOf("addLabel")).toHaveLength(0);
  });

  it("leaves no terminal label after a clarification outcome", async () => {
    const { client, process } = setup({}, makeAgent({ path: "clarification" }));
    await process({ issueKey: "IT-1", trigger: "assigned" });

    expect(client.callsOf("addLabel").map((call) => call.args[1])).toEqual([LABEL_IN_PROGRESS]);
    expect(client.callsOf("removeLabel").map((call) => call.args[1])).toEqual([LABEL_IN_PROGRESS]);
    expect(client.issues.get("IT-1")?.labels).toEqual([]);
  });

  it("swaps to fredy-failed when the agent throws", async () => {
    const { client, process, logger } = setup({}, makeAgent({}, new Error("llm down")));
    await process({ issueKey: "IT-1", trigger: "assigned" });

    expect(client.callsOf("addLabel").map((call) => call.args[1])).toEqual([
      LABEL_IN_PROGRESS,
      LABEL_FAILED,
    ]);
    expect(logger.error).toHaveBeenCalled();
    expect(client.issues.get("IT-1")?.labels).toEqual([LABEL_FAILED]);
  });

  it("label cleanup failures never mask the original error", async () => {
    const client = new FakeJiraClient();
    client.issues.set("IT-1", makeIssue());
    const agent = makeAgent({}, new Error("agent boom"));
    const logger = createTestLogger();
    const process = createTicketProcessor({
      client,
      agent,
      agentAccountId: AGENT_ACCOUNT,
      logger: logger.logger,
    });
    // Force the cleanup calls to fail after the agent error.
    const originalRemove = client.removeLabel.bind(client);
    let agentRan = false;
    client.removeLabel = async (key, label) => {
      if (agentRan) throw new Error("jira down");
      return originalRemove(key, label);
    };
    vi.mocked(agent.process).mockImplementation(async () => {
      agentRan = true;
      throw new Error("agent boom");
    });

    await expect(process({ issueKey: "IT-1", trigger: "assigned" })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
