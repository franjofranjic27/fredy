import { Observable } from "rxjs";
import { AgentRegistryService } from "../../shared/agents/agent-registry.service";
import { Agent } from "../../shared/agents/agent.interface";
import { LlmStreamChunk } from "../../shared/llm/llm.types";
import { WebService } from "./web.service";

function createAgent(
  overrides: Partial<{
    id: string;
    description: string;
    ownedBy: string;
    processMessage: jest.Mock;
    processMessageStream: jest.Mock;
  }> = {},
): Agent {
  return {
    descriptor: {
      id: overrides.id ?? "rag-agent",
      description: overrides.description ?? "test agent",
      ownedBy: overrides.ownedBy ?? "fredy",
    },
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
  } as unknown as Agent;
}

function createRegistry(agents: Agent[]): AgentRegistryService {
  const registry = new AgentRegistryService();
  for (const a of agents) registry.register(a);
  return registry;
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
    it("returns exactly one entry per registered agent", () => {
      const svc = new WebService(
        createRegistry([
          createAgent({ id: "rag-agent" }),
          createAgent({ id: "react-agent", ownedBy: "other" }),
        ]),
      );
      const result = svc.listModels();
      expect(result.object).toBe("list");
      expect(result.data.map((m) => m.id)).toEqual(["rag-agent", "react-agent"]);
      expect(result.data[0]).toMatchObject({ id: "rag-agent", owned_by: "fredy" });
      expect(result.data[1]).toMatchObject({ id: "react-agent", owned_by: "other" });
    });
  });

  describe("handleChatCompletion (non-stream)", () => {
    it("returns 400 when body fails zod validation", async () => {
      const svc = new WebService(createRegistry([createAgent()]));
      const r = createResponse();
      await svc.handleChatCompletion(createRequest(), r.res, { foo: "bar" });
      expect(r.statusCode).toBe(400);
      expect(r.jsonBody).toMatchObject({ error: { message: "Invalid request" } });
    });

    it("returns 400 when no user message is present", async () => {
      const svc = new WebService(createRegistry([createAgent()]));
      const r = createResponse();
      await svc.handleChatCompletion(createRequest(), r.res, {
        messages: [{ role: "assistant", content: "hi" }],
      });
      expect(r.statusCode).toBe(400);
    });

    it("delegates to the matching agent.processMessage and writes OpenAI-shaped JSON", async () => {
      const agent = createAgent({ id: "rag-agent" });
      const svc = new WebService(createRegistry([agent]));
      const r = createResponse();
      await svc.handleChatCompletion(createRequest(), r.res, {
        model: "rag-agent",
        messages: [{ role: "user", content: "How do I VPN?" }],
      });
      expect(agent.processMessage).toHaveBeenCalledWith(
        expect.objectContaining({ userMessage: "How do I VPN?" }),
      );
      expect(
        (r.jsonBody as { choices: Array<{ message: { content: string } }> }).choices[0].message
          .content,
      ).toBe("answer");
      expect(r.headers["x-session-id"]).toBeDefined();
    });

    it("forwards allowedToolNames from the RBAC-decorated request", async () => {
      const agent = createAgent();
      const svc = new WebService(createRegistry([agent]));
      const r = createResponse();
      await svc.handleChatCompletion(createRequest({}, ["vector_search"]), r.res, {
        model: "rag-agent",
        messages: [{ role: "user", content: "x" }],
      });
      expect(agent.processMessage).toHaveBeenCalledWith(
        expect.objectContaining({ allowedToolNames: ["vector_search"] }),
      );
    });

    it("defaults to the first registered agent when model is omitted", async () => {
      const agent = createAgent({ id: "rag-agent" });
      const svc = new WebService(createRegistry([agent]));
      const r = createResponse();
      await svc.handleChatCompletion(createRequest(), r.res, {
        messages: [{ role: "user", content: "x" }],
      });
      expect(agent.processMessage).toHaveBeenCalled();
    });

    it("throws BadRequestException when model does not match any agent", async () => {
      const svc = new WebService(createRegistry([createAgent({ id: "rag-agent" })]));
      const r = createResponse();
      await expect(
        svc.handleChatCompletion(createRequest(), r.res, {
          model: "gpt-4o",
          messages: [{ role: "user", content: "x" }],
        }),
      ).rejects.toThrow(/Unknown model/);
    });

    it("reuses an existing session id from the x-session-id header", async () => {
      const agent = createAgent();
      const svc = new WebService(createRegistry([agent]));
      const r = createResponse();
      await svc.handleChatCompletion(createRequest({ "x-session-id": "session-42" }), r.res, {
        model: "rag-agent",
        messages: [{ role: "user", content: "x" }],
      });
      expect(agent.processMessage).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session-42" }),
      );
      expect(r.headers["x-session-id"]).toBe("session-42");
    });
  });

  describe("handleChatCompletion (stream)", () => {
    it("emits data chunks and a [DONE] terminator", async () => {
      const agent = createAgent();
      const svc = new WebService(createRegistry([agent]));
      const r = createResponse();
      await svc.handleChatCompletion(createRequest(), r.res, {
        model: "rag-agent",
        stream: true,
        messages: [{ role: "user", content: "x" }],
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(r.headers["Content-Type"]).toBe("text/event-stream");
      const data = r.writeChunks.join("");
      expect(data).toContain("Hello ");
      expect(data).toContain("world.");
      expect(data).toContain("data: [DONE]");
    });
  });
});
