import { describe, expect, it, vi } from "vitest";
import { createJiraClient } from "./jira-client.js";
import { adfToPlainText } from "./types.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => (payload === undefined ? "" : JSON.stringify(payload)),
  } as unknown as Response;
}

function makeClient(fetchImpl: typeof fetch, sleep = vi.fn().mockResolvedValue(undefined)) {
  return {
    client: createJiraClient({
      baseUrl: "https://acme.atlassian.net/",
      email: "bot@acme.test",
      apiToken: "tok",
      fetchImpl,
      sleep,
    }),
    sleep,
  };
}

describe("createJiraClient", () => {
  it("sends basic auth and strips the trailing base URL slash", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ key: "IT-1", fields: {} }));
    const { client } = makeClient(fetchImpl);
    await client.getIssue("IT-1");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://acme.atlassian.net/rest/api/3/issue/IT-1?fields=summary,description,reporter,assignee,status,issuetype,labels,created,updated",
    );
    const expected = `Basic ${Buffer.from("bot@acme.test:tok").toString("base64")}`;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: expected });
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("URL-encodes issue keys so they can never alter the request path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const { client } = makeClient(fetchImpl);
    await client.assignIssue("IT-1/../secret?x=1", "u1");

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      `https://acme.atlassian.net/rest/api/3/issue/${encodeURIComponent("IT-1/../secret?x=1")}/assignee`,
    );
  });

  it("normalises issue fields including the ADF description", async () => {
    const description = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "line one" }] },
        { type: "paragraph", content: [{ type: "text", text: "line two" }] },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        key: "IT-2",
        fields: {
          summary: "Sum",
          description,
          reporter: { accountId: "u1", displayName: "Rita" },
          assignee: null,
          status: { name: "To Do", statusCategory: { key: "new" } },
          issuetype: { name: "Task" },
          labels: ["a"],
        },
      }),
    );
    const { client } = makeClient(fetchImpl);
    const issue = await client.getIssue("IT-2");

    expect(issue).toMatchObject({
      key: "IT-2",
      summary: "Sum",
      description: "line one\nline two",
      reporter: { accountId: "u1", displayName: "Rita" },
      assignee: undefined,
      status: { name: "To Do", category: "new" },
      issueType: "Task",
      labels: ["a"],
    });
  });

  it("searches via POST /search/jql with jql, maxResults and fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ issues: [] }));
    const { client } = makeClient(fetchImpl);
    await client.searchIssues("project = IT", 10);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/search/jql");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.jql).toBe("project = IT");
    expect(body.maxResults).toBe(10);
    expect(body.fields).toContain("summary");
  });

  it("retries exactly once on 429 honouring Retry-After", async () => {
    const rateLimited = {
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "2" }),
      text: async () => "",
    } as unknown as Response;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(jsonResponse({ key: "IT-1", fields: {} }));
    const { client, sleep } = makeClient(fetchImpl);

    const issue = await client.getIssue("IT-1");
    expect(issue.key).toBe("IT-1");
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caps the 429 backoff at 30 seconds", async () => {
    const rateLimited = {
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "600" }),
      text: async () => "",
    } as unknown as Response;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(jsonResponse({ key: "IT-1", fields: {} }));
    const { client, sleep } = makeClient(fetchImpl);
    await client.getIssue("IT-1");
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it("fails with method, path, status and a body snippet", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ errorMessages: ["Issue does not exist"] }, 404));
    const { client } = makeClient(fetchImpl);
    await expect(client.getIssue("IT-404")).rejects.toThrow(
      /Jira GET \/rest\/api\/3\/issue\/IT-404.*failed: 404 — .*Issue does not exist/,
    );
  });

  it("adds and removes labels via the issue update endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const { client } = makeClient(fetchImpl);
    await client.addLabel("IT-1", "fredy-in-progress");
    await client.removeLabel("IT-1", "fredy-in-progress");

    const addBody = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(addBody).toEqual({ update: { labels: [{ add: "fredy-in-progress" }] } });
    const removeBody = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    expect(removeBody).toEqual({ update: { labels: [{ remove: "fredy-in-progress" }] } });
  });

  it("handles empty 204 bodies for side-effect calls", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const { client } = makeClient(fetchImpl);
    await expect(client.assignIssue("IT-1", null)).resolves.toBeUndefined();
    await expect(client.transitionIssue("IT-1", "31")).resolves.toBeUndefined();
  });

  it("maps comments and transitions", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          comments: [
            {
              id: "1",
              author: { accountId: "u1", displayName: "Rita" },
              body: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
              },
              created: "2026-01-01",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ transitions: [{ id: "31", name: "Done" }] }));
    const { client } = makeClient(fetchImpl);

    const comments = await client.getComments("IT-1");
    expect(comments).toEqual([
      {
        id: "1",
        author: { accountId: "u1", displayName: "Rita" },
        body: "hi",
        created: "2026-01-01",
      },
    ]);
    const transitions = await client.getTransitions("IT-1");
    expect(transitions).toEqual([{ id: "31", name: "Done" }]);
  });
});

describe("adfToPlainText", () => {
  it("joins paragraphs with newlines and honours hard breaks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "hardBreak" },
            { type: "text", text: "b" },
          ],
        },
        { type: "heading", content: [{ type: "text", text: "H" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }],
            },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe("a\nb\nH\nitem");
  });

  it("returns an empty string for null input", () => {
    expect(adfToPlainText(null)).toBe("");
  });
});
