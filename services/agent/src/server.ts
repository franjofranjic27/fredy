import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { AgentRegistry, Logger, ToolRegistry } from "@fredy/agent-core";
import type { AppConfig } from "./config.js";
import { createAuthHook, type TokenVerifier } from "./plugins/auth.js";
import { createRbacHook } from "./plugins/rbac.js";
import { createRateLimitHook, TokenBucketRateLimiter } from "./plugins/rate-limit.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerModelsRoute } from "./routes/models.js";
import { registerChatCompletionsRoute } from "./routes/chat-completions.js";

export interface ServerDeps {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly agentRegistry: AgentRegistry;
  readonly toolRegistry: ToolRegistry;
  /** Test seam for JWT verification (defaults to jose + remote JWKS). */
  readonly verifyToken?: TokenVerifier;
}

/**
 * Assembles the Fastify app: auth on every request (except /health), RBAC and
 * rate limiting only on /v1/chat/completions — mirroring the old guard and
 * interceptor placement.
 */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const { config, logger } = deps;

  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy: config.trustProxy,
    disableRequestLogging: true,
  });

  if (!config.auth.keycloak.jwksUrl && !config.auth.apiKey) {
    logger.warn(
      "ANONYMOUS ACCESS ENABLED — no Keycloak and no AGENT_API_KEY configured. " +
        "All requests are unauthenticated. Do not use this outside local development.",
    );
  }

  app.addHook(
    "onRequest",
    createAuthHook({
      apiKey: config.auth.apiKey,
      jwksUrl: config.auth.keycloak.jwksUrl,
      issuer: config.auth.keycloak.issuer,
      audience: config.auth.keycloak.audience,
      logger,
      verifyToken: deps.verifyToken,
    }),
  );

  const rbacHook = createRbacHook({
    keycloakEnabled: Boolean(config.auth.keycloak.jwksUrl),
    roleToolConfig: config.auth.roleToolConfig,
    listToolNames: () => deps.toolRegistry.listNames(),
    logger,
  });

  const rateLimiter = new TokenBucketRateLimiter({
    rpm: config.rateLimit.rpm,
    burst: config.rateLimit.burst,
  });
  rateLimiter.startEviction();
  app.addHook("onClose", async () => rateLimiter.stopEviction());

  registerHealthRoute(app);
  registerModelsRoute(app, deps.agentRegistry);
  registerChatCompletionsRoute(app, {
    agents: deps.agentRegistry,
    logger,
    preHandlers: [rbacHook, createRateLimitHook(rateLimiter)],
  });

  return app;
}
