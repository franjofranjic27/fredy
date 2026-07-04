import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { createTestLogger } from "../testing/test-logger.js";

const SECRET = "webhook-secret";

function makeApp(secret?: string) {
  const config = loadConfig({
    JIRA_BASE_URL: "https://acme.atlassian.net",
    JIRA_EMAIL: "bot@acme.test",
    JIRA_API_TOKEN: "token",
    JIRA_PROJECT_KEY: "IT",
    JIRA_AGENT_ACCOUNT_ID: "712020:abc",
    JIRA_WEBHOOK_SECRET: secret ?? "",
  });
  const enqueue = vi.fn().mockReturnValue(true);
  const logger = createTestLogger();
  const app = buildServer({
    config,
    logger: logger.logger,
    getPollerStatus: () => ({ lastRunAt: null, lastError: null, queueDepth: 0 }),
    enqueue,
  });
  return { app, enqueue, logger };
}

function sign(payload: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function post(app: ReturnType<typeof makeApp>["app"], payload: string, signature?: string) {
  return app.inject({
    method: "POST",
    url: "/webhooks/jira",
    payload,
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-hub-signature": signature } : {}),
    },
  });
}

const ISSUE_CREATED = JSON.stringify({
  webhookEvent: "jira:issue_created",
  issue: { key: "IT-7" },
});

describe("POST /webhooks/jira", () => {
  it("accepts a correctly signed issue event and enqueues it", async () => {
    const { app, enqueue } = makeApp(SECRET);
    const response = await post(app, ISSUE_CREATED, sign(ISSUE_CREATED));

    expect(response.statusCode).toBe(204);
    expect(enqueue).toHaveBeenCalledWith({ issueKey: "IT-7", trigger: "assigned" });
    await app.close();
  });

  it("rejects an invalid signature with 401", async () => {
    const { app, enqueue } = makeApp(SECRET);
    const response = await post(app, ISSUE_CREATED, sign(ISSUE_CREATED, "wrong-secret"));

    expect(response.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a missing signature header with 401", async () => {
    const { app, enqueue } = makeApp(SECRET);
    const response = await post(app, ISSUE_CREATED);

    expect(response.statusCode).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 403 when no webhook secret is configured", async () => {
    const { app, enqueue } = makeApp();
    const response = await post(app, ISSUE_CREATED, sign(ISSUE_CREATED));

    expect(response.statusCode).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
    await app.close();
  });

  it("acks a validly signed but unexpected payload without enqueueing", async () => {
    const { app, enqueue, logger } = makeApp(SECRET);
    const payload = JSON.stringify({ something: "else" });
    const response = await post(app, payload, sign(payload));

    expect(response.statusCode).toBe(204);
    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    await app.close();
  });

  it("acks non-issue events without enqueueing", async () => {
    const { app, enqueue } = makeApp(SECRET);
    const payload = JSON.stringify({ webhookEvent: "comment_created", issue: { key: "IT-7" } });
    const response = await post(app, payload, sign(payload));

    expect(response.statusCode).toBe(204);
    expect(enqueue).not.toHaveBeenCalled();
    await app.close();
  });
});
