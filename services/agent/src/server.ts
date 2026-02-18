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
import type { AgentConfig } from "./agent.js";

const MODEL_ID = "fredy-it-agent";
const CHUNK_SIZE = 20;

export function createApp(config: AgentConfig): Hono {
  const app = new Hono();

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

    if (!stream) {
      const result = await runAgent(config, messages);
      return c.json(createCompletionResponse(result.response, MODEL_ID));
    }

    // Streaming: run agent to completion, then send chunks
    return streamSSE(c, async (sseStream) => {
      const result = await runAgent(config, messages);
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
