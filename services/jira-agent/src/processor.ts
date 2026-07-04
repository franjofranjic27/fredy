import type { Logger } from "@fredy/agent-core";
import type { TicketAgent, TicketEvent } from "./agent/types.js";
import type { JiraClient } from "./jira/jira-client.js";
import type { TicketEventProcessor } from "./queue.js";
import { ALL_AGENT_LABELS, LABEL_DONE, LABEL_FAILED, LABEL_IN_PROGRESS } from "./labels.js";

export interface TicketProcessorDeps {
  readonly client: JiraClient;
  readonly agent: TicketAgent;
  readonly agentAccountId: string;
  readonly logger: Logger;
}

/**
 * Claim lifecycle around the agent core. Jira labels are the source of
 * truth: re-fetch → skip when already claimed/finished or reassigned →
 * claim with fredy-in-progress → process → terminal label.
 *
 * A clarification outcome gets NO terminal label on purpose: the ticket
 * goes back to the reporter, and when it is reassigned to the agent the
 * poll JQL (which excludes all agent labels) must pick it up again.
 */
export function createTicketProcessor(deps: TicketProcessorDeps): TicketEventProcessor {
  const { client, agent, agentAccountId, logger } = deps;

  return async (event: TicketEvent): Promise<void> => {
    const issue = await client.getIssue(event.issueKey);

    const agentLabel = issue.labels.find((label) =>
      (ALL_AGENT_LABELS as readonly string[]).includes(label),
    );
    if (agentLabel) {
      logger.info(`Skipping ${event.issueKey}: already labelled ${agentLabel}`);
      return;
    }
    if (issue.assignee?.accountId !== agentAccountId) {
      logger.info(`Skipping ${event.issueKey}: not assigned to the agent account`);
      return;
    }

    await client.addLabel(event.issueKey, LABEL_IN_PROGRESS);
    try {
      const outcome = await agent.process(event);
      await client.removeLabel(event.issueKey, LABEL_IN_PROGRESS);
      if (outcome.path !== "clarification") {
        await client.addLabel(event.issueKey, LABEL_DONE);
      }
      logger.info(
        `Processed ${event.issueKey}: path=${outcome.path} actions=${outcome.actionsApplied.length}`,
      );
    } catch (error) {
      logger.error(
        { err: error },
        `Processing ${event.issueKey} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Best effort: never mask the original failure with label errors.
      await client.removeLabel(event.issueKey, LABEL_IN_PROGRESS).catch(() => undefined);
      await client.addLabel(event.issueKey, LABEL_FAILED).catch(() => undefined);
    }
  };
}
