import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Logger } from "@fredy/agent-core";
import type { JiraAgentConfig } from "./config.js";
import type { TicketEvent } from "./agent/types.js";
import { registerHealthRoute, type PollerStatus } from "./routes/health.js";
import { registerJiraWebhookRoute } from "./routes/jira-webhook.js";

export interface ServerDeps {
  readonly config: JiraAgentConfig;
  readonly logger: Logger;
  readonly getPollerStatus: () => PollerStatus;
  readonly enqueue: (event: TicketEvent) => boolean;
}

/**
 * Assembles the Fastify app. The service has no user-facing auth: /health is
 * public, and the webhook route authenticates itself via HMAC signature.
 */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    disableRequestLogging: true,
  });

  registerHealthRoute(app, deps.getPollerStatus);
  registerJiraWebhookRoute(app, {
    secret: deps.config.jira.webhookSecret,
    enqueue: deps.enqueue,
    logger: deps.logger,
  });

  return app;
}
