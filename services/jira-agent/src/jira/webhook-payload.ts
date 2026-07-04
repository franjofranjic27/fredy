import { z } from "zod";

/**
 * Deliberately lax: Jira webhook payloads are large and versioned, we only
 * need the event name and the issue key. Everything else is ignored.
 */
export const jiraWebhookPayloadSchema = z.object({
  webhookEvent: z.string(),
  issue: z.object({ key: z.string().min(1) }).optional(),
});

export type JiraWebhookPayload = z.infer<typeof jiraWebhookPayloadSchema>;

export const ISSUE_EVENTS: ReadonlySet<string> = new Set([
  "jira:issue_created",
  "jira:issue_updated",
]);
