import type { CacheHit } from "../../cache/ticket-cache.js";
import type { TicketSnapshot } from "../../jira/types.js";

/**
 * Untrusted ticket text only ever enters prompts inside these delimited data
 * blocks, paired with the hardening rule in every system prompt.
 */
export function ticketBlock(ticket: TicketSnapshot): string {
  const { issue } = ticket;
  return [
    "<ticket>",
    `key: ${issue.key}`,
    `type: ${issue.issueType}`,
    `status: ${issue.status.name}`,
    `reporter: ${issue.reporter?.displayName ?? "unknown"}`,
    `summary: ${issue.summary}`,
    "description:",
    issue.description || "(empty)",
    "</ticket>",
  ].join("\n");
}

export function commentsBlock(ticket: TicketSnapshot, agentAccountId: string): string {
  if (ticket.comments.length === 0) return "<comments>\n(none)\n</comments>";
  const rendered = ticket.comments
    .map((comment) => {
      const role = comment.author.accountId === agentAccountId ? "agent (you)" : "reporter/user";
      return `[${role} — ${comment.author.displayName}]\n${comment.body}`;
    })
    .join("\n---\n");
  return `<comments>\n${rendered}\n</comments>`;
}

export function cacheHitsBlock(hits: readonly CacheHit[]): string {
  if (hits.length === 0) return "<similar_resolved_tickets>\n(none)\n</similar_resolved_tickets>";
  const rendered = hits
    .map(
      (hit) =>
        `[${hit.ticketKey} — similarity ${hit.score.toFixed(2)}${hit.strong ? ", strong match" : ""}]\n` +
        `Question: ${hit.question}\nResolution: ${hit.resolution}`,
    )
    .join("\n---\n");
  return `<similar_resolved_tickets>\n${rendered}\n</similar_resolved_tickets>`;
}

export function contextBlock(context: string | null): string {
  if (!context) return "<retrieved_context>\n(none retrieved)\n</retrieved_context>";
  return `<retrieved_context>\n${context}\n</retrieved_context>`;
}
