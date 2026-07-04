import { describe, expect, it } from "vitest";
import { createTestLogger } from "../testing/test-logger.js";
import { makeIssue } from "../testing/fake-jira-client.js";
import type { TicketSnapshot } from "../jira/types.js";
import { createAccessRequestHandler } from "./access-request-handler.js";

function snapshot(overrides: Parameters<typeof makeIssue>[0] = {}): TicketSnapshot {
  return { issue: makeIssue(overrides), comments: [] };
}

const deps = { logger: createTestLogger().logger };

describe("access-request handler matching", () => {
  const handler = createAccessRequestHandler();

  it("matches German access service requests", () => {
    const ticket = snapshot({
      issueType: "Service Request",
      summary: "Zugriff auf das Confluence-Space IT",
    });
    expect(handler.matches(ticket)).toBe(true);
  });

  it("matches English permission requests", () => {
    const ticket = snapshot({ issueType: "Service Request", summary: "Need admin permission" });
    expect(handler.matches(ticket)).toBe(true);
  });

  it("does not match access wording on other issue types", () => {
    const ticket = snapshot({ issueType: "Bug", summary: "Zugriff auf Datenbank kaputt" });
    expect(handler.matches(ticket)).toBe(false);
  });

  it("does not match service requests without access wording", () => {
    const ticket = snapshot({ issueType: "Service Request", summary: "New laptop please" });
    expect(handler.matches(ticket)).toBe(false);
  });
});

describe("access-request handler response", () => {
  const handler = createAccessRequestHandler();

  it("answers German tickets with the German checklist and hands back to the reporter", async () => {
    const ticket = snapshot({
      issueType: "Service Request",
      summary: "Zugriff auf Grafana",
      description: "Ich brauche bitte Zugriff auf unser Grafana.",
    });
    const result = await handler.handle(ticket, deps);
    expect(result.comment).toContain("Zielsystem");
    expect(result.outcome).toBe("needs-reporter");
    expect(result.assignTo).toBe("reporter");
    expect(result.transitionIntent).toBe("waiting-for-reporter");
  });

  it("answers English tickets with the English checklist", async () => {
    const ticket = snapshot({
      issueType: "Service Request",
      summary: "Access to Grafana",
      description: "Need access to our Grafana instance.",
    });
    const result = await handler.handle(ticket, deps);
    expect(result.comment).toContain("Target system");
  });
});
