import { ACTION_META, describeAction, type JiraAction } from "./actions.js";

export interface ActionGateContext {
  readonly issueKey: string;
}

/**
 * Approval seam in front of every side-effecting action. v1 auto-approves
 * Jira-internal writes; anything with external blast radius (future PR/email
 * tools) must go through a human-in-the-loop gate implementation instead.
 */
export interface ActionGate {
  approve(action: JiraAction, context: ActionGateContext): Promise<void>;
}

export class AutoApproveGate implements ActionGate {
  async approve(action: JiraAction, context: ActionGateContext): Promise<void> {
    if (ACTION_META[action.type].blastRadius !== "jira-internal") {
      throw new Error(
        `Action ${describeAction(action)} on ${context.issueKey} requires human approval — ` +
          "no HITL gate is configured",
      );
    }
  }
}
