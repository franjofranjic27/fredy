import type { JiraClient } from "../jira/jira-client.js";
import type { AdfDocument, JiraComment, JiraIssue, JiraTransition } from "../jira/types.js";

export interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export function makeIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: "IT-1",
    summary: "VPN not working",
    description: "I cannot connect to the VPN since this morning.",
    reporter: { accountId: "reporter-1", displayName: "Rita Reporter" },
    assignee: { accountId: "agent-1", displayName: "Fredy Agent" },
    status: { name: "To Do", category: "new" },
    issueType: "Service Request",
    labels: [],
    created: "2026-01-01T09:00:00.000+0000",
    updated: "2026-01-01T09:00:00.000+0000",
    ...overrides,
  };
}

/** In-memory JiraClient recording every call; label mutations are applied. */
export class FakeJiraClient implements JiraClient {
  readonly calls: RecordedCall[] = [];
  issues = new Map<string, JiraIssue>();
  comments = new Map<string, JiraComment[]>();
  transitions: JiraTransition[] = [];
  searchResults: JiraIssue[] = [];
  failOn?: { method: string; error: Error };

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
    if (this.failOn?.method === method) throw this.failOn.error;
  }

  callsOf(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  async getIssue(key: string): Promise<JiraIssue> {
    this.record("getIssue", key);
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`Jira GET /issue/${key} failed: 404`);
    return issue;
  }

  async getComments(key: string): Promise<JiraComment[]> {
    this.record("getComments", key);
    return this.comments.get(key) ?? [];
  }

  async searchIssues(jql: string, maxResults?: number): Promise<JiraIssue[]> {
    this.record("searchIssues", jql, maxResults);
    return this.searchResults;
  }

  async getTransitions(key: string): Promise<JiraTransition[]> {
    this.record("getTransitions", key);
    return this.transitions;
  }

  async addComment(key: string, body: AdfDocument): Promise<void> {
    this.record("addComment", key, body);
  }

  async assignIssue(key: string, accountId: string | null): Promise<void> {
    this.record("assignIssue", key, accountId);
  }

  async transitionIssue(key: string, transitionId: string): Promise<void> {
    this.record("transitionIssue", key, transitionId);
  }

  async addLabel(key: string, label: string): Promise<void> {
    this.record("addLabel", key, label);
    const issue = this.issues.get(key);
    if (issue) this.issues.set(key, { ...issue, labels: [...issue.labels, label] });
  }

  async removeLabel(key: string, label: string): Promise<void> {
    this.record("removeLabel", key, label);
    const issue = this.issues.get(key);
    if (issue) {
      this.issues.set(key, { ...issue, labels: issue.labels.filter((l) => l !== label) });
    }
  }
}
