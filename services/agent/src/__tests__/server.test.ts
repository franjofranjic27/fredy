import { describe, it, expect } from "vitest";
import { createApp } from "../server.js";
import { ToolRegistry } from "../tools/registry.js";
import { createMockLLMClient } from "./helpers/mock-llm.js";
import { createLogger } from "../logger.js";
import type { LLMResponse, Message } from "../llm/types.js";

const silentLogger = createLogger({ level: "error", output: () => {} });

function makeApp(responses: LLMResponse[] = [], captured?: Message[][]) {
  const config = {
    llm: createMockLLMClient(responses, captured),
    tools: new ToolRegistry(),
    systemPrompt: "Test",
    maxIterations: 5,
    verbose: false,
    logger: silentLogger,
  };
  return createApp(config);
}

describe("GET /health", () => {
  it("returns 200 with ok status", async () => {
    const app = makeApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});

describe("GET /v1/models", () => {
  it("returns model list", async () => {
    const app = makeApp();
    const res = await app.request("/v1/models");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("fredy-it-agent");
    expect(body.data[0].object).toBe("model");
  });
});

describe("POST /v1/chat/completions", () => {
  it("returns 400 for empty messages array", async () => {
    const app = makeApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when no user message", async () => {
    const app = makeApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test",
        messages: [{ role: "system", content: "System only" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("forwards token usage to response body", async () => {
    const app = makeApp([{
      content: "Hello!",
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 150, outputTokens: 75 },
    }]);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "Hi" }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usage).toEqual({ prompt_tokens: 150, completion_tokens: 75, total_tokens: 225 });
  });

  it("returns completion for valid request", async () => {
    const app = makeApp([
      {
        content: "Hello!",
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fredy-it-agent",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("Hello!");
  });
});

describe("Session memory", () => {
  it("generates and returns x-session-id header", async () => {
    const app = makeApp([{ content: "Hi!", toolCalls: [], stopReason: "end_turn" }]);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "Hello" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-session-id")).toBeTruthy();
  });

  it("echoes back the provided x-session-id", async () => {
    const app = makeApp([{ content: "Hi!", toolCalls: [], stopReason: "end_turn" }]);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": "my-session" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "Hello" }] }),
    });
    expect(res.headers.get("x-session-id")).toBe("my-session");
  });

  it("includes prior turn in context on second request", async () => {
    const captured: Message[][] = [];
    const app = makeApp(
      [
        { content: "Paris.", toolCalls: [], stopReason: "end_turn" },
        { content: "It is the capital.", toolCalls: [], stopReason: "end_turn" },
      ],
      captured
    );

    // First turn
    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": "sess-1" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "Capital of France?" }] }),
    });

    // Second turn — same session
    await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": "sess-1" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "Tell me more." }] }),
    });

    // Second LLM call should include the first user+assistant exchange
    const secondCallMessages = captured[1]!;
    expect(secondCallMessages.some((m) => m.role === "user" && m.content === "Capital of France?")).toBe(true);
    expect(secondCallMessages.some((m) => m.role === "assistant" && m.content === "Paris.")).toBe(true);
  });

  it("keeps sessions isolated by session ID", async () => {
    const capturedA: Message[][] = [];
    const capturedB: Message[][] = [];
    const appA = makeApp(
      [
        { content: "Session A reply.", toolCalls: [], stopReason: "end_turn" },
        { content: "A second.", toolCalls: [], stopReason: "end_turn" },
      ],
      capturedA
    );
    const appB = makeApp(
      [{ content: "Session B reply.", toolCalls: [], stopReason: "end_turn" }],
      capturedB
    );

    await appA.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": "sess-a" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "Hello A" }] }),
    });

    await appB.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": "sess-b" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "Hello B" }] }),
    });

    // Second request to A — B's history must not appear
    await appA.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": "sess-a" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "Follow up A" }] }),
    });

    const secondA = capturedA[1]!;
    expect(secondA.some((m) => m.content === "Hello B")).toBe(false);
    expect(secondA.some((m) => m.content === "Hello A")).toBe(true);
  });
});
