import type { FetchLike } from "@fredy/agent-core";
import {
  adfToPlainText,
  type AdfDocument,
  type AdfNode,
  type JiraComment,
  type JiraIssue,
  type JiraTransition,
  type JiraUser,
} from "./types.js";

export interface JiraClient {
  /** readOnly */
  getIssue(key: string): Promise<JiraIssue>;
  /** readOnly */
  getComments(key: string): Promise<JiraComment[]>;
  /** readOnly */
  searchIssues(jql: string, maxResults?: number): Promise<JiraIssue[]>;
  /** readOnly */
  getTransitions(key: string): Promise<JiraTransition[]>;
  /** SIDE-EFFECT */
  addComment(key: string, body: AdfDocument): Promise<void>;
  /** SIDE-EFFECT — accountId null unassigns. */
  assignIssue(key: string, accountId: string | null): Promise<void>;
  /** SIDE-EFFECT */
  transitionIssue(key: string, transitionId: string): Promise<void>;
  /** SIDE-EFFECT */
  addLabel(key: string, label: string): Promise<void>;
  /** SIDE-EFFECT */
  removeLabel(key: string, label: string): Promise<void>;
}

export interface JiraClientOptions {
  readonly baseUrl: string;
  readonly email: string;
  readonly apiToken: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  /** Test seam for the 429 backoff. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_JIRA_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 30_000;
const ISSUE_FIELDS =
  "summary,description,reporter,assignee,status,issuetype,labels,created,updated";

interface RawUser {
  accountId?: string;
  displayName?: string;
}

interface RawIssue {
  key?: string;
  fields?: {
    summary?: string;
    description?: AdfNode | string | null;
    reporter?: RawUser | null;
    assignee?: RawUser | null;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    labels?: string[];
    created?: string;
    updated?: string;
  };
}

interface RawComment {
  id?: string;
  author?: RawUser;
  body?: AdfNode | string | null;
  created?: string;
}

function parseUser(raw: RawUser | null | undefined): JiraUser | undefined {
  if (!raw?.accountId) return undefined;
  return { accountId: raw.accountId, displayName: raw.displayName ?? "" };
}

function toPlainText(body: AdfNode | string | null | undefined): string {
  if (typeof body === "string") return body.trim();
  return adfToPlainText(body);
}

function parseIssue(raw: RawIssue): JiraIssue {
  const fields = raw.fields ?? {};
  return {
    key: raw.key ?? "",
    summary: fields.summary ?? "",
    description: toPlainText(fields.description),
    reporter: parseUser(fields.reporter),
    assignee: parseUser(fields.assignee),
    status: {
      name: fields.status?.name ?? "",
      category: fields.status?.statusCategory?.key ?? "",
    },
    issueType: fields.issuetype?.name ?? "",
    labels: fields.labels ?? [],
    created: fields.created ?? "",
    updated: fields.updated ?? "",
  };
}

function parseComment(raw: RawComment): JiraComment {
  return {
    id: raw.id ?? "",
    author: parseUser(raw.author) ?? { accountId: "", displayName: "" },
    body: toPlainText(raw.body),
    created: raw.created ?? "",
  };
}

/**
 * Minimal Jira Cloud REST v3 client. Basic auth (email + API token), request
 * timeout, and a single retry honouring Retry-After on 429.
 */
export function createJiraClient(options: JiraClientOptions): JiraClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_JIRA_TIMEOUT_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const authorization = `Basic ${Buffer.from(`${options.email}:${options.apiToken}`).toString("base64")}`;

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const doFetch = () =>
      fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

    let response = await doFetch();
    if (response.status === 429) {
      const retryAfterSec = Number(response.headers.get("retry-after") ?? "1");
      const waitMs = Math.min(
        Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 1000,
        MAX_RETRY_AFTER_MS,
      );
      await sleep(waitMs);
      response = await doFetch();
    }
    if (!response.ok) {
      const snippet = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(
        `Jira ${method} ${path} failed: ${response.status}${snippet ? ` — ${snippet}` : ""}`,
      );
    }
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }

  function updateLabels(key: string, operation: "add" | "remove", label: string): Promise<unknown> {
    return request("PUT", `/rest/api/3/issue/${key}`, {
      update: { labels: [{ [operation]: label }] },
    });
  }

  return {
    async getIssue(key) {
      const raw = (await request(
        "GET",
        `/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS}`,
      )) as RawIssue;
      return parseIssue(raw);
    },
    async getComments(key) {
      const raw = (await request("GET", `/rest/api/3/issue/${key}/comment`)) as {
        comments?: RawComment[];
      };
      return (raw.comments ?? []).map(parseComment);
    },
    async searchIssues(jql, maxResults = 50) {
      const raw = (await request("POST", "/rest/api/3/search/jql", {
        jql,
        maxResults,
        fields: ISSUE_FIELDS.split(","),
      })) as { issues?: RawIssue[] };
      return (raw.issues ?? []).map(parseIssue);
    },
    async getTransitions(key) {
      const raw = (await request("GET", `/rest/api/3/issue/${key}/transitions`)) as {
        transitions?: Array<{ id?: string; name?: string }>;
      };
      return (raw.transitions ?? []).map((transition) => ({
        id: transition.id ?? "",
        name: transition.name ?? "",
      }));
    },
    async addComment(key, body) {
      await request("POST", `/rest/api/3/issue/${key}/comment`, { body });
    },
    async assignIssue(key, accountId) {
      await request("PUT", `/rest/api/3/issue/${key}/assignee`, { accountId });
    },
    async transitionIssue(key, transitionId) {
      await request("POST", `/rest/api/3/issue/${key}/transitions`, {
        transition: { id: transitionId },
      });
    },
    async addLabel(key, label) {
      await updateLabels(key, "add", label);
    },
    async removeLabel(key, label) {
      await updateLabels(key, "remove", label);
    },
  };
}
