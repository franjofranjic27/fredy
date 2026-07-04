import type { TransitionIntent } from "../agent/types.js";

/**
 * The action plan the graph produces and the executor applies. Keeping this
 * a closed union (instead of free tool calls) is the core of the agent's
 * prompt-injection stance: untrusted ticket text can steer the wording of a
 * comment, but never which actions run.
 */
export type JiraAction =
  | { readonly type: "addComment"; readonly markdown: string }
  | { readonly type: "assignIssue"; readonly accountId: string | null }
  | { readonly type: "transition"; readonly intent: TransitionIntent };

export interface ActionMeta {
  readonly readOnly: boolean;
  readonly blastRadius: "jira-internal" | "external";
}

/**
 * Classification required by the side-effecting-tools checklist
 * (docs/rag-eval-guide.md §6): every action declares its blast radius so the
 * gate can demand human approval before anything leaves Jira.
 */
export const ACTION_META: Record<JiraAction["type"], ActionMeta> = {
  addComment: { readOnly: false, blastRadius: "jira-internal" },
  assignIssue: { readOnly: false, blastRadius: "jira-internal" },
  transition: { readOnly: false, blastRadius: "jira-internal" },
};

export function describeAction(action: JiraAction): string {
  switch (action.type) {
    case "addComment":
      return "addComment";
    case "assignIssue":
      return `assignIssue:${action.accountId ?? "unassign"}`;
    case "transition":
      return `transition:${action.intent}`;
  }
}
