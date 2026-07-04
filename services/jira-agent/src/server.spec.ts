import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";
import { createTestLogger } from "./testing/test-logger.js";

function makeServer() {
  const config = loadConfig({
    JIRA_BASE_URL: "https://acme.atlassian.net",
    JIRA_EMAIL: "bot@acme.test",
    JIRA_API_TOKEN: "token",
    JIRA_PROJECT_KEY: "IT",
    JIRA_AGENT_ACCOUNT_ID: "712020:abc",
  });
  return buildServer({
    config,
    logger: createTestLogger().logger,
    getPollerStatus: () => ({ lastRunAt: "2026-01-01T00:00:00Z", lastError: null, queueDepth: 2 }),
    enqueue: () => true,
  });
}

describe("GET /health", () => {
  it("reports ok including the poller status", async () => {
    const app = makeServer();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      poller: { lastRunAt: "2026-01-01T00:00:00Z", lastError: null, queueDepth: 2 },
    });
    await app.close();
  });
});
