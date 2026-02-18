import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { runAgent } from "./agent.js";
import { createAgentConfig } from "./setup.js";
import {
  ChatCompletionRequestSchema,
  createCompletionResponse,
  createCompletionChunk,
} from "./openai-types.js";
import { AgentError } from "./agent.js";
import type { AgentConfig } from "./agent.js";
import type { Message } from "./llm/types.js";
import { createLogger } from "./logger.js";

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface SessionEntry {
  messages: Message[];
  lastActivity: number;
}

const MODEL_ID = "fredy-it-agent";
const CHUNK_SIZE = 20;

export function createApp(config: AgentConfig): Hono {
  const app = new Hono();
  const AGENT_API_KEY = process.env.AGENT_API_KEY;
  const logger = config.logger ?? createLogger();

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

  const sessions = new Map<string, SessionEntry>();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessions) {
      if (now - entry.lastActivity > SESSION_TTL_MS) {
        sessions.delete(id);
      }
    }
  }, SESSION_TTL_MS);
  cleanupInterval.unref();

  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();   // health stays open
    if (!AGENT_API_KEY) return next();             // no key → dev mode
    const auth = c.req.header("authorization") ?? "";
    const [scheme, token] = auth.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || token !== AGENT_API_KEY) {
      return c.json({ error: { message: "Invalid API key" } }, 401);
    }
    return next();
  });

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
    const session = sessions.get(sessionId) ?? { messages: [], lastActivity: Date.now() };
    const lastUserContent = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";

    c.header("x-session-id", sessionId);

    const updateSession = (assistantResponse: string) => {
      session.messages.push(
        { role: "user", content: lastUserContent },
        { role: "assistant", content: assistantResponse }
      );
      session.lastActivity = Date.now();
      sessions.set(sessionId, session);
    };

    const statusMap: Record<string, number> = {
      RATE_LIMITED: 429,
      API_ERROR: 502,
      MAX_ITERATIONS: 500,
      TOOL_ERROR: 500,
      UNKNOWN: 500,
    };

    if (!stream) {
      try {
        const result = await runAgent(config, messages, session.messages);
        updateSession(result.response);
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

    // Streaming: run agent to completion, then send chunks
    return streamSSE(c, async (sseStream) => {
      const result = await runAgent(config, messages, session.messages);
      updateSession(result.response);
      logger.info("agent run complete", {
        session_id: sessionId,
        iterations: result.iterations,
        tools_used: result.toolsUsed.length,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        stream: true,
      });
      const id = `chatcmpl-${crypto.randomUUID()}`;
      const text = result.response;

      // Send role chunk
      await sseStream.writeSSE({
        data: JSON.stringify(createCompletionChunk(id, "", null, MODEL_ID)),
      });

      // Send content in small chunks
      for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        const slice = text.slice(i, i + CHUNK_SIZE);
        await sseStream.writeSSE({
          data: JSON.stringify(createCompletionChunk(id, slice, null, MODEL_ID)),
        });
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
  const port = parseInt(process.env.PORT ?? "8001", 10);
  console.log(`Fredy Agent initialized — tools: ${config.tools.list().join(", ")}`);
  serve({ fetch: createApp(config).fetch, port }, () => {
    console.log(`Fredy Agent API listening on http://0.0.0.0:${port}`);
  });
}
