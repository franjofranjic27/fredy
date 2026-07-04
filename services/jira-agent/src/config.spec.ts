import { describe, expect, it } from "vitest";
import { defaultPollJql, loadConfig } from "./config.js";

const REQUIRED_ENV = {
  JIRA_BASE_URL: "https://acme.atlassian.net",
  JIRA_EMAIL: "bot@acme.test",
  JIRA_API_TOKEN: "token",
  JIRA_PROJECT_KEY: "IT",
  JIRA_AGENT_ACCOUNT_ID: "712020:abc",
};

function load(env: NodeJS.ProcessEnv = {}) {
  return loadConfig({ ...REQUIRED_ENV, ...env });
}

describe("loadConfig", () => {
  it("applies the documented defaults with only required vars set", () => {
    const config = load();
    expect(config.port).toBe(8002);
    expect(config.logLevel).toBe("info");
    expect(config.jira.baseUrl).toBe("https://acme.atlassian.net");
    expect(config.jira.pollIntervalMs).toBe(60_000);
    expect(config.jira.webhookSecret).toBeUndefined();
    expect(config.jira.transitions).toEqual({
      resolve: "Done",
      waitingForReporter: "Waiting for customer",
    });
    expect(config.database.url).toBe("postgresql://fredy:fredy@localhost:5432/fredy");
    expect(config.database.chunksTable).toBe("chunks");
    expect(config.database.ticketCacheTable).toBe("jira_ticket_cache");
    expect(config.llm.fallbackModel).toBe("claude-sonnet-4-5-20250929");
    expect(config.embedding.provider).toBe("openai");
    expect(config.retrieval).toEqual({ defaultLimit: 5, scoreThreshold: 0.7 });
  });

  it.each(Object.keys(REQUIRED_ENV))("fails fast when %s is missing", (key) => {
    const env: NodeJS.ProcessEnv = { ...REQUIRED_ENV };
    delete env[key];
    expect(() => loadConfig(env)).toThrow(new RegExp(key));
  });

  it("treats empty strings as unset, also for required vars", () => {
    expect(() => load({ JIRA_API_TOKEN: "" })).toThrow(/JIRA_API_TOKEN/);
    expect(load({ JIRA_WEBHOOK_SECRET: "" }).jira.webhookSecret).toBeUndefined();
    expect(load({ JIRA_POLL_INTERVAL_MS: "" }).jira.pollIntervalMs).toBe(60_000);
  });

  it("strips trailing slashes from the base URL", () => {
    expect(load({ JIRA_BASE_URL: "https://acme.atlassian.net/" }).jira.baseUrl).toBe(
      "https://acme.atlassian.net",
    );
  });

  it("derives the default poll JQL from project and account", () => {
    const config = load();
    expect(config.jira.pollJql).toBe(defaultPollJql("IT", "712020:abc"));
    expect(config.jira.pollJql).toContain('project = "IT"');
    expect(config.jira.pollJql).toContain('assignee = "712020:abc"');
    expect(config.jira.pollJql).toContain("labels IS EMPTY OR labels NOT IN");
    expect(config.jira.pollJql).toContain("fredy-in-progress, fredy-done, fredy-failed");
  });

  it("an explicit JIRA_POLL_JQL overrides the derived JQL", () => {
    const config = load({ JIRA_POLL_JQL: "project = IT ORDER BY created ASC" });
    expect(config.jira.pollJql).toBe("project = IT ORDER BY created ASC");
  });

  it("fails fast on non-numeric numeric envs", () => {
    expect(() => load({ JIRA_POLL_INTERVAL_MS: "soon" })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it("embedding fallbacks mirror the RAG agent behaviour", () => {
    const config = load({ EMBEDDING_API_KEY: "shared", EMBEDDING_VOYAGE_MODEL: "voyage-3" });
    expect(config.embedding.openai.apiKey).toBe("shared");
    expect(config.embedding.openai.model).toBe("text-embedding-3-small");
    expect(config.embedding.voyage.model).toBe("voyage-3");
  });
});
