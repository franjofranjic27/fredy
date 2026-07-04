import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Logger } from "@fredy/agent-core";
import type { TicketEvent } from "../agent/types.js";
import { ISSUE_EVENTS, jiraWebhookPayloadSchema } from "../jira/webhook-payload.js";

export interface JiraWebhookRouteOptions {
  /** Unset disables the route entirely (403). */
  readonly secret?: string;
  readonly enqueue: (event: TicketEvent) => boolean;
  readonly logger: Logger;
}

interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer;
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Immediate-ack webhook: authenticate via HMAC over the RAW body, enqueue
 * the issue key and reply 204 — never do agent work in the request cycle
 * (Jira retries on slow responses).
 */
export function registerJiraWebhookRoute(
  app: FastifyInstance,
  options: JiraWebhookRouteOptions,
): void {
  const { secret, enqueue, logger } = options;

  // The HMAC must cover the exact bytes Jira sent, so JSON parsing keeps the
  // raw buffer around. This parser is app-wide; the webhook is the only JSON
  // route in this service.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    (request as RawBodyRequest).rawBody = body as Buffer;
    try {
      const text = (body as Buffer).toString("utf8");
      done(null, text.length ? JSON.parse(text) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  if (!secret) {
    logger.info("Jira webhooks disabled — JIRA_WEBHOOK_SECRET is not configured");
  }

  app.post("/webhooks/jira", async (request, reply) => {
    if (!secret) {
      return reply.code(403).send({ error: "Webhooks are disabled" });
    }

    const rawBody = (request as RawBodyRequest).rawBody ?? Buffer.alloc(0);
    const signature = request.headers["x-hub-signature"];
    const signatureHeader = Array.isArray(signature) ? signature[0] : signature;
    if (!verifyWebhookSignature(secret, rawBody, signatureHeader)) {
      logger.warn("Rejected Jira webhook with missing or invalid signature");
      return reply.code(401).send({ error: "Invalid signature" });
    }

    const parsed = jiraWebhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      logger.warn("Ignoring Jira webhook with unexpected payload shape");
      return reply.code(204).send();
    }

    const { webhookEvent, issue } = parsed.data;
    if (ISSUE_EVENTS.has(webhookEvent) && issue) {
      const accepted = enqueue({ issueKey: issue.key, trigger: "assigned" });
      logger.info(`Webhook ${webhookEvent} for ${issue.key}: ${accepted ? "enqueued" : "deduped"}`);
    }
    return reply.code(204).send();
  });
}
