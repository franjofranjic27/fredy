import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Logger } from "@fredy/agent-core";
import type { JiraAgentConfig } from "./config.js";
import { registerHealthRoute, type PollerStatus } from "./routes/health.js";

export interface ServerDeps {
  readonly config: JiraAgentConfig;
  readonly logger: Logger;
  readonly getPollerStatus: () => PollerStatus;
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

  return app;
}
