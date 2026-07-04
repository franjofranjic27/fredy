import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JiraPoller } from "./poller.js";
import { TicketQueue } from "./queue.js";
import { FakeJiraClient, makeIssue } from "./testing/fake-jira-client.js";
import { createTestLogger } from "./testing/test-logger.js";
import { LABEL_IN_PROGRESS } from "./labels.js";

function makePoller(client: FakeJiraClient, intervalMs = 60_000) {
  const logger = createTestLogger();
  const queue = new TicketQueue(logger.logger);
  const enqueued: string[] = [];
  queue.start(async (event) => {
    enqueued.push(`${event.issueKey}:${event.trigger}`);
  });
  const poller = new JiraPoller({
    client,
    queue,
    logger: logger.logger,
    jql: "poll-jql",
    intervalMs,
    projectKey: "IT",
  });
  return { poller, queue, enqueued, logger };
}

describe("JiraPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the first poll immediately and enqueues found issues", async () => {
    const client = new FakeJiraClient();
    client.searchResults = [makeIssue({ key: "IT-1" }), makeIssue({ key: "IT-2" })];
    const { poller, enqueued } = makePoller(client);

    await poller.start();
    await vi.runOnlyPendingTimersAsync();

    expect(enqueued).toContain("IT-1:assigned");
    expect(enqueued).toContain("IT-2:assigned");
    expect(poller.status.lastRunAt).not.toBeNull();
    expect(poller.status.lastError).toBeNull();
    poller.stop();
  });

  it("stays disabled when intervalMs is 0", async () => {
    const client = new FakeJiraClient();
    const { poller } = makePoller(client, 0);
    await poller.start();
    expect(client.callsOf("searchIssues")).toHaveLength(0);
  });

  it("records errors and keeps the loop alive", async () => {
    const client = new FakeJiraClient();
    client.failOn = { method: "searchIssues", error: new Error("jira down") };
    const { poller, logger } = makePoller(client, 1000);

    await poller.start();
    expect(poller.status.lastError).toContain("jira down");
    expect(logger.error).toHaveBeenCalled();

    // Next tick still fires and recovers once Jira answers again.
    client.failOn = undefined;
    client.searchResults = [];
    await vi.advanceTimersByTimeAsync(1000);
    expect(poller.status.lastError).toBeNull();
    poller.stop();
  });

  it("reclaims stale in-progress tickets at startup", async () => {
    const client = new FakeJiraClient();
    const stale = makeIssue({ key: "IT-9", labels: [LABEL_IN_PROGRESS] });
    client.issues.set("IT-9", stale);
    // First search = reclaim JQL, second = poll JQL.
    let call = 0;
    const original = client.searchIssues.bind(client);
    client.searchIssues = async (jql, max) => {
      call += 1;
      if (call === 1) {
        expect(jql).toContain("labels = fredy-in-progress");
        expect(jql).toContain("updated <= -30m");
        return [stale];
      }
      return original(jql, max);
    };
    const { poller, enqueued } = makePoller(client);

    await poller.start();
    await vi.runOnlyPendingTimersAsync();

    expect(client.callsOf("removeLabel")).toEqual([
      { method: "removeLabel", args: ["IT-9", LABEL_IN_PROGRESS] },
    ]);
    expect(enqueued).toContain("IT-9:reprocess");
    poller.stop();
  });

  it("stop() prevents any further ticks", async () => {
    const client = new FakeJiraClient();
    const { poller } = makePoller(client, 1000);
    await poller.start();
    const callsAfterStart = client.callsOf("searchIssues").length;

    poller.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.callsOf("searchIssues").length).toBe(callsAfterStart);
  });
});
