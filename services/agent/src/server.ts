import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { runAgent, AgentError } from "./agent.js";
import { createAgentConfig } from "./setup.js";
import { parseRoleToolConfig, resolveRole, buildFilteredRegistry } from "./rbac.js";
import { verifyToken, extractRoleFromClaims } from "./auth.js";
import {
  ChatCompletionRequestSchema,
  createCompletionResponse,
  createCompletionChunk,
} from "./openai-types.js";
import type { AgentConfig } from "./agent.js";
import type { Message } from "./llm/types.js";
import { createLogger } from "./logger.js";
import type { SessionStore } from "./session/types.js";
import { MemorySessionStore } from "./session/memory.js";
import { createRateLimiter } from "./middleware/rate-limit.js";

type Env = { Variables: { jwtRole: string | null } };

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface SessionEntry {
  messages: Message[];
  lastActivity: number;
}

const MODEL_ID = "fredy-it-agent";

export function createApp(config: AgentConfig, sessionStore?: SessionStore): Hono<Env> {
  const app = new Hono<Env>();
  const AGENT_API_KEY = process.env.AGENT_API_KEY;
  const KEYCLOAK_JWKS_URL = process.env.KEYCLOAK_JWKS_URL;
  const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER;
  const KEYCLOAK_AUDIENCE = process.env.KEYCLOAK_AUDIENCE ?? "fredy-agent";
  const logger = config.logger ?? createLogger();

  // Throws at startup if ROLE_TOOL_CONFIG is set but malformed
  const roleToolConfig = parseRoleToolConfig(process.env.ROLE_TOOL_CONFIG);

  const store: SessionStore = sessionStore ?? new MemorySessionStore();

  // Request timing — must be first so it wraps everything including auth
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    logger.info("http request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Date.now() - start,
    });
  });

  const cleanupInterval = setInterval(() => {
    void store.cleanup(SESSION_TTL_MS);
  }, SESSION_TTL_MS);
  cleanupInterval.unref();

  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();

    const auth = c.req.header("authorization") ?? "";
    const [scheme, token] = auth.split(" ");

    if (!KEYCLOAK_JWKS_URL) {
      // Dev mode: no Keycloak — fall back to static API key check
      if (AGENT_API_KEY && (scheme?.toLowerCase() !== "bearer" || token !== AGENT_API_KEY)) {
        return c.json({ error: { message: "Invalid API key" } }, 401);
      }
      c.set("jwtRole", null);
      return next();
    }

    // Keycloak mode: validate JWT
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      return c.json({ error: { message: "Bearer token required" } }, 401);
    }
    try {
      const claims = await verifyToken(token, KEYCLOAK_JWKS_URL, KEYCLOAK_ISSUER!, KEYCLOAK_AUDIENCE);
      c.set("jwtRole", extractRoleFromClaims(claims));
    } catch {
      return c.json({ error: { message: "Invalid or expired token" } }, 401);
    }
    return next();
  });

  // Rate limiting on the chat endpoint
  const rateLimiter = createRateLimiter({
    rpm: Number.parseInt(process.env.RATE_LIMIT_RPM ?? "60", 10),
    burst: Number.parseInt(process.env.RATE_LIMIT_BURST ?? "10", 10),
  });
  app.use("/v1/chat/completions", rateLimiter);

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/v1/models", (c) =>
    c.json({
      object: "list",
      data: [
        {
          id: MODEL_ID,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "fredy",
        },
      ],
    })
  );

  app.post("/v1/chat/completions", async (c) => {
    const body = await c.req.json();
    const parsed = ChatCompletionRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { error: { message: "Invalid request", details: parsed.error.issues } },
        400
      );
    }

    const { messages, stream } = parsed.data;

    if (!messages.some((m) => m.role === "user")) {
      return c.json(
        { error: { message: "No user message found" } },
        400
      );
    }

    const sessionId = c.req.header("x-session-id") ?? crypto.randomUUID();
    const existingSession = await store.get(sessionId);
    const session: SessionEntry = existingSession ?? { messages: [], lastActivity: Date.now() };
    const lastUserContent = messages.findLast((m) => m.role === "user")?.content ?? "";

    c.header("x-session-id", sessionId);

    const updateSession = async (assistantResponse: string) => {
      session.messages.push(
        { role: "user", content: lastUserContent },
        { role: "assistant", content: assistantResponse }
      );
      session.lastActivity = Date.now();
      await store.set(sessionId, session);
    };

    const statusMap: Record<string, number> = {
      RATE_LIMITED: 429,
      API_ERROR: 502,
      MAX_ITERATIONS: 500,
      TOOL_ERROR: 500,
      UNKNOWN: 500,
    };

    const role = resolveRole({ get: (n) => c.req.header(n) }, c.get("jwtRole"));
    const requestConfig: AgentConfig = {
      ...config,
      tools: buildFilteredRegistry(config.tools, role, roleToolConfig),
    };
    logger.info("rbac resolved", {
      session_id: sessionId,
      role,
      tools_allowed: requestConfig.tools.list(),
    });

    if (!stream) {
      try {
        const result = await runAgent(requestConfig, messages, session.messages);
        await updateSession(result.response);
        logger.info("agent run complete", {
          session_id: sessionId,
          iterations: result.iterations,
          tools_used: result.toolsUsed.length,
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
        });
        return c.json(createCompletionResponse(result.response, MODEL_ID, result.usage));
      } catch (error) {
        if (error instanceof AgentError) {
          logger.error("agent run failed", { session_id: sessionId, code: error.code, message: error.message });
          return c.json(
            { error: { message: error.message, code: error.code } },
            statusMap[error.code] as 429 | 500 | 502
          );
        }
        logger.error("unexpected error", { session_id: sessionId, error: String(error) });
        return c.json({ error: { message: "Internal server error" } }, 500);
      }
    }

    // Streaming: forward token deltas as they arrive from the LLM
    const id = `chatcmpl-${crypto.randomUUID()}`;
    return streamSSE(c, async (sseStream) => {
      // Send role chunk so the client knows a message is starting
      await sseStream.writeSSE({
        data: JSON.stringify(createCompletionChunk(id, "", null, MODEL_ID)),
      });

      try {
        const result = await runAgent(
          requestConfig,
          messages,
          session.messages,
          async (delta) => {
            await sseStream.writeSSE({
              data: JSON.stringify(createCompletionChunk(id, delta, null, MODEL_ID)),
            });
          },
        );

        await updateSession(result.response);
        logger.info("agent run complete", {
          session_id: sessionId,
          iterations: result.iterations,
          tools_used: result.toolsUsed.length,
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          stream: true,
        });
      } catch (error) {
        if (error instanceof AgentError) {
          logger.error("agent run failed", { session_id: sessionId, code: error.code, message: error.message, stream: true });
        } else {
          logger.error("unexpected streaming error", { session_id: sessionId, error: String(error) });
        }
        // Stream is aborted — client sees connection closed
        return;
      }

      // Send finish chunk
      await sseStream.writeSSE({
        data: JSON.stringify(createCompletionChunk(id, null, "stop", MODEL_ID)),
      });

      // Send [DONE]
      await sseStream.writeSSE({ data: "[DONE]" });
    });
  });

  return app;
}

// Only start the HTTP server when not running under vitest
if (!process.env.VITEST) {
  const config = createAgentConfig();
  const port = Number.parseInt(process.env.PORT ?? "8001", 10);
  console.log(`Fredy Agent initialized — tools: ${config.tools.list().join(", ")}`);
  serve({ fetch: createApp(config).fetch, port }, () => {
    console.log(`Fredy Agent API listening on http://0.0.0.0:${port}`);
  });
}
