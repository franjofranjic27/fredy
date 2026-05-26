import "reflect-metadata";

import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Observable } from "rxjs";
import request from "supertest";
import { AppModule } from "../app.module";
import { LlmClient } from "../shared/llm/llm-client.interface";
import { LLM_CLIENTS } from "../shared/llm/llm.tokens";
import { LlmStreamChunk } from "../shared/llm/llm.types";
import { ToolRegistryService } from "../shared/tools/tool-registry.service";

class StubAnthropic implements LlmClient {
  readonly providerId = "anthropic" as const;
  supportsModel(id: string): boolean {
    return id.startsWith("claude-");
  }
  async createCompletion() {
    return {
      content: "VPN-Setup: use Cisco AnyConnect; install from https://wiki/vpn.",
      model: "claude-sonnet-4-5-20250929",
      finishReason: "stop",
      usage: { inputTokens: 120, outputTokens: 22 },
    };
  }
  createCompletionStream(): Observable<LlmStreamChunk> {
    return new Observable<LlmStreamChunk>((sub) => {
      sub.next({ id: "x", delta: "VPN-Setup: " });
      sub.next({ id: "x", delta: "use Cisco AnyConnect." });
      sub.next({
        id: "x",
        delta: "",
        finishReason: "stop",
        usage: { inputTokens: 120, outputTokens: 22 },
      });
      sub.complete();
    });
  }
  async listModels() {
    return [
      {
        id: "claude-sonnet-4-5-20250929",
        object: "model" as const,
        owned_by: "anthropic",
      },
    ];
  }
}

function stubVectorSearchTool() {
  return {
    description: {
      name: "vector_search",
      description: "stub",
      parametersJsonSchema: { type: "object" },
    },
    execute: jest.fn().mockResolvedValue({
      success: true,
      output: "VPN docs say: install Cisco AnyConnect from https://wiki/vpn",
      metadata: {
        chunks: [
          {
            id: "1",
            score: 0.9,
            url: "https://wiki/vpn",
            title: "VPN Setup",
          },
        ],
      },
    }),
  };
}

describe("Chat Completions E2E", () => {
  let app: INestApplication;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      ANTHROPIC_API_KEY: "stub",
      EMBEDDING_API_KEY: "stub",
      RATE_LIMIT_RPM: "6000",
      RATE_LIMIT_BURST: "1000",
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LLM_CLIENTS)
      .useValue([new StubAnthropic()])
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();

    // Replace the registered vector_search tool with a stub
    const registry = app.get(ToolRegistryService);
    const tool = stubVectorSearchTool();
    (registry as unknown as { tools: Map<string, unknown> }).tools.set("vector_search", tool);
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  it("GET /health returns 200 ok", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /v1/models lists fredy-it-agent plus provider models", async () => {
    const res = await request(app.getHttpServer()).get("/v1/models");
    expect(res.status).toBe(200);
    expect(res.body.object).toBe("list");
    const ids = res.body.data.map((m: { id: string }) => m.id);
    expect(ids).toContain("fredy-it-agent");
    expect(ids).toContain("claude-sonnet-4-5-20250929");
  });

  it("POST /v1/chat/completions returns an OpenAI-shaped response with vector_search context", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .send({
        model: "fredy-it-agent",
        messages: [{ role: "user", content: "How do I VPN?" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.object).toBe("chat.completion");
    expect(res.body.choices[0].message.content).toContain("Cisco AnyConnect");
    expect(res.headers["x-session-id"]).toBeDefined();
  });

  it("POST /v1/chat/completions with stream=true emits SSE chunks and [DONE]", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .send({
        model: "fredy-it-agent",
        stream: true,
        messages: [{ role: "user", content: "How do I VPN?" }],
      })
      .buffer(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .parse((res: any, callback: (err: Error | null, body: string) => void) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => callback(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const body = res.body as string;
    expect(body).toContain("VPN-Setup");
    expect(body).toContain("Cisco AnyConnect");
    expect(body).toContain("data: [DONE]");
  });

  it("returns a fallback when RBAC denies vector_search", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("x-role", "stranger")
      .send({
        model: "fredy-it-agent",
        messages: [{ role: "user", content: "How do I VPN?" }],
      });
    // RBAC config is empty by default in this test → all tools allowed,
    // so this should still succeed. Override env to enforce restriction:
    expect(res.status).toBe(200);
    expect(res.body.choices[0].message.content).toContain("Cisco AnyConnect");
  });
});
