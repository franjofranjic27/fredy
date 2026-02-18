import { describe, it, expect } from "vitest";
import { createApp } from "../server.js";
import { ToolRegistry } from "../tools/registry.js";
import { createMockLLMClient } from "./helpers/mock-llm.js";
import type { LLMResponse } from "../llm/types.js";

function makeApp(responses: LLMResponse[] = []) {
  const config = {
    llm: createMockLLMClient(responses),
    tools: new ToolRegistry(),
    systemPrompt: "Test",
    maxIterations: 5,
    verbose: false,
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
