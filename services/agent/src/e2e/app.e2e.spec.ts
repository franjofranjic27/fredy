import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentRegistry, ToolRegistry } from "@fredy/agent-core";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../config.js";
import { createRagAgent } from "../agents/rag-agent/rag-agent.js";
import { RAG_FALLBACK_RESPONSE } from "../agents/rag-agent/system-prompt.js";
import { buildServer } from "../server.js";
import type { VectorSearchHit } from "../tools/pgvector.js";
import { FakeChatModel } from "../testing/fake-chat-model.js";
import { createTestLogger } from "../testing/test-logger.js";

function stubVectorSearchTool() {
  const hits: VectorSearchHit[] = [
    {
      id: "1",
      score: 0.9,
      payload: {
        title: "VPN Setup",
        content: "VPN docs say: install Cisco AnyConnect from https://wiki/vpn",
        url: "https://wiki/vpn",
      },
    },
  ];
  return tool(
    async (): Promise<[string, { hits: VectorSearchHit[] }]> => [
      "VPN docs say: install Cisco AnyConnect from https://wiki/vpn",
      { hits },
    ],
    {
      name: "vector_search",
      description: "stub",
      schema: z.object({
        query: z.string(),
        limit: z.number().optional(),
        spaceKey: z.string().optional(),
      }),
      responseFormat: "content_and_artifact",
    },
  );
}

function buildApp(env: NodeJS.ProcessEnv = {}): FastifyInstance {
  const config = loadConfig({
    AGENT_ALLOW_ANONYMOUS: "true",
    RATE_LIMIT_RPM: "6000",
    RATE_LIMIT_BURST: "1000",
    ...env,
  });
  const logger = createTestLogger().logger;

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(stubVectorSearchTool());

  const model = new FakeChatModel({
    response: "VPN-Setup: use Cisco AnyConnect; install from https://wiki/vpn.",
    chunks: ["VPN-Setup: ", "use Cisco AnyConnect."],
    usage: { input_tokens: 120, output_tokens: 22, total_tokens: 142 },
    modelName: "claude-sonnet-4-5-20250929",
  });

  const agentRegistry = new AgentRegistry();
  agentRegistry.register(createRagAgent(), {
    config,
    toolRegistry,
    reranker: null,
    logger,
    createModel: () => model,
  });

  return buildServer({ config, logger, agentRegistry, toolRegistry });
}

describe("Chat Completions E2E", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns 200 ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("GET /v1/models lists exactly one entry per registered agent", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/models" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.object).toBe("list");
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(["rag-agent"]);
    expect(body.data[0].owned_by).toBe("fredy");
    expect(body.data[0].object).toBe("model");
  });

  it("POST /v1/chat/completions returns an OpenAI-shaped response with vector_search context", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "rag-agent",
        messages: [{ role: "user", content: "How do I VPN?" }],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.role).toBe("assistant");
    expect(body.choices[0].message.content).toContain("Cisco AnyConnect");
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(response.headers["x-session-id"]).toBeDefined();
  });

  it("includes the usage block computed from the LLM result", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "rag-agent",
        messages: [{ role: "user", content: "How do I VPN?" }],
      },
    });
    expect(response.json().usage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 22,
      total_tokens: 142,
    });
  });

  it("echoes a provided x-session-id header", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "x-session-id": "session-42" },
      payload: {
        model: "rag-agent",
        messages: [{ role: "user", content: "How do I VPN?" }],
      },
    });
    expect(response.headers["x-session-id"]).toBe("session-42");
  });

  it("defaults to the first registered agent when no model is given", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { messages: [{ role: "user", content: "How do I VPN?" }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().model).toBe("rag-agent");
  });

  it("rejects unknown models with 400 and the available-agents message", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "x" }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe(
      'Unknown model "claude-sonnet-4-5". Available agents: rag-agent',
    );
  });

  it("rejects malformed bodies with 400 Invalid request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { messages: [] },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.message).toBe("Invalid request");
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it("rejects requests without a user message", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "rag-agent",
        messages: [{ role: "assistant", content: "only me" }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe("No user message found");
  });

  it("streams SSE chunks with a role-bearing first delta, content and [DONE]", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "rag-agent",
        stream: true,
        messages: [{ role: "user", content: "How do I VPN?" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["x-session-id"]).toBeDefined();

    const body = response.body;
    expect(body).toContain("VPN-Setup");
    expect(body).toContain("Cisco AnyConnect");
    // [DONE] must be the terminal SSE frame, not merely present somewhere.
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);

    const events = body
      .split("\n\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map((line) => JSON.parse(line.slice("data: ".length)));

    // FIX: the first delta must announce the assistant role.
    expect(events[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
    // All chunks share a stable chatcmpl id.
    const ids = new Set(events.map((event) => event.id));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^chatcmpl-/);
    // Terminal chunk carries the stop finish_reason with an empty delta.
    const terminal = events[events.length - 1];
    expect(terminal.choices[0].delta).toEqual({});
    expect(terminal.choices[0].finish_reason).toBe("stop");
  });

  it("appends a usage chunk after the stop chunk when stream_options.include_usage is set", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "rag-agent",
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: "How do I VPN?" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const events = response.body
      .split("\n\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map((line) => JSON.parse(line.slice("data: ".length)));

    const usageChunk = events[events.length - 1];
    expect(usageChunk.choices).toEqual([]);
    expect(usageChunk.usage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 22,
      total_tokens: 142,
    });
    // The stop chunk still precedes the usage chunk.
    expect(events[events.length - 2].choices[0].finish_reason).toBe("stop");
  });

  it("rejects an out-of-range temperature at the API boundary", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "rag-agent",
        temperature: 3,
        messages: [{ role: "user", content: "How do I VPN?" }],
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns the verbatim refusal when RBAC denies vector_search", async () => {
    const restricted = buildApp({
      ROLE_TOOL_CONFIG: '{"admin":["vector_search"],"user":["vector_search"]}',
    });
    await restricted.ready();
    try {
      const response = await restricted.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "x-role": "stranger" },
        payload: {
          model: "rag-agent",
          messages: [{ role: "user", content: "How do I VPN?" }],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().choices[0].message.content).toBe(RAG_FALLBACK_RESPONSE);
      expect(response.json().usage).toBeUndefined();
    } finally {
      await restricted.close();
    }
  });

  it("streams the refusal as a single delta when RBAC denies vector_search", async () => {
    const restricted = buildApp({ ROLE_TOOL_CONFIG: '{"admin":["vector_search"]}' });
    await restricted.ready();
    try {
      const response = await restricted.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "x-role": "stranger" },
        payload: {
          model: "rag-agent",
          stream: true,
          messages: [{ role: "user", content: "How do I VPN?" }],
        },
      });
      expect(response.statusCode).toBe(200);

      // The refusal is emitted verbatim as a single content delta.
      const deltas = response.body
        .split("\n\n")
        .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.slice("data: ".length)))
        .map((event) => event.choices[0].delta.content ?? "")
        .join("");
      expect(deltas).toBe(RAG_FALLBACK_RESPONSE);
      expect(response.body.trimEnd().endsWith("data: [DONE]")).toBe(true);
    } finally {
      await restricted.close();
    }
  });

  it("enforces the API key when AGENT_API_KEY is set", async () => {
    const secured = buildApp({ AGENT_API_KEY: "s3cret" });
    await secured.ready();
    try {
      const denied = await secured.inject({ method: "GET", url: "/v1/models" });
      expect(denied.statusCode).toBe(401);
      const allowed = await secured.inject({
        method: "GET",
        url: "/v1/models",
        headers: { authorization: "Bearer s3cret" },
      });
      expect(allowed.statusCode).toBe(200);
      const health = await secured.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
    } finally {
      await secured.close();
    }
  });

  it("rate limits POST /v1/chat/completions with 429 and Retry-After", async () => {
    const limited = buildApp({ RATE_LIMIT_RPM: "60", RATE_LIMIT_BURST: "1" });
    await limited.ready();
    try {
      const payload = {
        model: "rag-agent",
        messages: [{ role: "user", content: "How do I VPN?" }],
      };
      const first = await limited.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload,
      });
      expect(first.statusCode).toBe(200);
      const second = await limited.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload,
      });
      expect(second.statusCode).toBe(429);
      expect(second.headers["retry-after"]).toBeDefined();
      expect(second.json().error).toMatchObject({
        message: "Rate limit exceeded",
        code: "RATE_LIMITED",
      });
    } finally {
      await limited.close();
    }
  });
});
