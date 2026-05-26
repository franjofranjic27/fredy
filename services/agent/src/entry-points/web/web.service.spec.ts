import { Observable } from "rxjs";
import { RagAgentService } from "../../agents/rag-agent/rag-agent.service";
import { LlmRegistryService } from "../../shared/llm/llm-registry.service";
import { LlmStreamChunk } from "../../shared/llm/llm.types";
import { AGENT_MODEL_ID } from "./web.types";
import { WebService } from "./web.service";

function createRegistry(): LlmRegistryService {
  return {
    listAllModels: jest.fn().mockResolvedValue([
      { id: "claude-sonnet-4-5", object: "model", owned_by: "anthropic" },
      { id: "gpt-4o", object: "model", owned_by: "openai" },
    ]),
  } as unknown as LlmRegistryService;
}

function createRagAgent(
  overrides: Partial<{
    processMessage: jest.Mock;
    processMessageStream: jest.Mock;
  }> = {},
): RagAgentService {
  return {
    processMessage:
      overrides.processMessage ??
      jest.fn().mockResolvedValue({ content: "answer", model: "claude-sonnet-4-5" }),
    processMessageStream:
      overrides.processMessageStream ??
      jest.fn().mockImplementation(
        () =>
          new Observable<LlmStreamChunk>((sub) => {
            sub.next({ id: "x", delta: "Hello " });
            sub.next({ id: "x", delta: "world." });
            sub.next({ id: "x", delta: "", finishReason: "stop" });
            sub.complete();
          }),
      ),
  } as unknown as RagAgentService;
}

function createRequest(headers: Record<string, string> = {}, allowedToolNames?: string[]) {
  return {
    header: (name: string) => headers[name.toLowerCase()],
    allowedToolNames,
  } as unknown as Parameters<WebService["handleChatCompletion"]>[0];
}

function createResponse() {
  const writeChunks: string[] = [];
  let statusCode = 200;
  let jsonBody: unknown;
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    flushHeaders: jest.fn(),
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      jsonBody = body;
      return this;
    },
    write(chunk: string) {
      writeChunks.push(chunk);
      return true;
    },
    end: jest.fn(),
    on: jest.fn(),
  };
  return {
    res: res as unknown as Parameters<WebService["handleChatCompletion"]>[1],
    writeChunks,
    headers,
    get statusCode() {
      return statusCode;
    },
    get jsonBody() {
      return jsonBody;
    },
  };
}

describe("WebService", () => {
  describe("listModels", () => {
    it("returns the agent model id alongside provider models", async () => {
      const svc = new WebService(createRagAgent(), createRegistry());
      const result = await svc.listModels();
      expect(result.object).toBe("list");
      expect(result.data[0]).toMatchObject({
        id: AGENT_MODEL_ID,
        owned_by: "fredy",
      });
      expect(result.data.map((m) => m.id)).toContain("claude-sonnet-4-5");
      expect(result.data.map((m) => m.id)).toContain("gpt-4o");
    });
  });

  describe("handleChatCompletion (non-stream)", () => {
    it("returns 400 when body fails zod validation", async () => {
      const svc = new WebService(createRagAgent(), createRegistry());
      const r = createResponse();
      await svc.handleChatCompletion(createRequest(), r.res, { foo: "bar" });
      expect(r.statusCode).toBe(400);
      expect(r.jsonBody).toMatchObject({ error: { message: "Invalid request" } });
    });

    it("returns 400 when no user message is present", async () => {
      const svc = new WebService(createRagAgent(), createRegistry());
      const r = createResponse();
      await svc.handleChatCompletion(createRequest(), r.res, {
        messages: [{ role: "assistant", content: "hi" }],
      });
      expect(r.statusCode).toBe(400);
    });

    it("delegates to RagAgentService.processMessage and writes OpenAI-shaped JSON", async () => {
      const ragAgent = createRagAgent();
      const svc = new WebService(ragAgent, createRegistry());
      const r = createResponse();
      await svc.handleChatCompletion(createRequest(), r.res, {
        messages: [{ role: "user", content: "How do I VPN?" }],
      });
      expect(ragAgent.processMessage).toHaveBeenCalledWith(
        expect.objectContaining({ userMessage: "How do I VPN?" }),
      );
      expect(
        (r.jsonBody as { choices: Array<{ message: { content: string } }> }).choices[0].message
          .content,
      ).toBe("answer");
      expect(r.headers["x-session-id"]).toBeDefined();
    });

    it("forwards allowedToolNames from the RBAC-decorated request", async () => {
      const ragAgent = createRagAgent();
      const svc = new WebService(ragAgent, createRegistry());
      const r = createResponse();
      await svc.handleChatCompletion(createRequest({}, ["vector_search"]), r.res, {
        messages: [{ role: "user", content: "x" }],
      });
      expect(ragAgent.processMessage).toHaveBeenCalledWith(
        expect.objectContaining({ allowedToolNames: ["vector_search"] }),
      );
    });

    it("hides the agent model id from the RAG agent so the registry picks the default", async () => {
      const ragAgent = createRagAgent();
      const svc = new WebService(ragAgent, createRegistry());
      const r = createResponse();
      await svc.handleChatCompletion(createRequest(), r.res, {
        model: AGENT_MODEL_ID,
        messages: [{ role: "user", content: "x" }],
      });
      expect(ragAgent.processMessage).toHaveBeenCalledWith(
        expect.objectContaining({ model: undefined }),
      );
    });

    it("reuses an existing session id from the x-session-id header", async () => {
      const ragAgent = createRagAgent();
      const svc = new WebService(ragAgent, createRegistry());
      const r = createResponse();
      await svc.handleChatCompletion(createRequest({ "x-session-id": "session-42" }), r.res, {
        messages: [{ role: "user", content: "x" }],
      });
      expect(ragAgent.processMessage).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session-42" }),
      );
      expect(r.headers["x-session-id"]).toBe("session-42");
    });
  });

  describe("handleChatCompletion (stream)", () => {
    it("emits data chunks and a [DONE] terminator", async () => {
      const ragAgent = createRagAgent();
      const svc = new WebService(ragAgent, createRegistry());
      const r = createResponse();
      await svc.handleChatCompletion(createRequest(), r.res, {
        stream: true,
        messages: [{ role: "user", content: "x" }],
      });
      // wait a tick for the synchronous observable to drain
      await new Promise((resolve) => setImmediate(resolve));
      expect(r.headers["Content-Type"]).toBe("text/event-stream");
      const data = r.writeChunks.join("");
      expect(data).toContain("Hello ");
      expect(data).toContain("world.");
      expect(data).toContain("data: [DONE]");
    });
  });
});
