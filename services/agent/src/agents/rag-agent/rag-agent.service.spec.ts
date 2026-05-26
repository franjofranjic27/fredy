import { ConfigService } from "@nestjs/config";
import { Observable, firstValueFrom, toArray } from "rxjs";
import { AgentRegistryService } from "../../shared/agents/agent-registry.service";
import { LlmClient } from "../../shared/llm/llm-client.interface";
import { LlmRegistryService } from "../../shared/llm/llm-registry.service";
import { LlmStreamChunk } from "../../shared/llm/llm.types";
import { SessionService } from "../../shared/memory/session/session.service";
import { ObservabilityService } from "../../shared/observability/observability.service";
import { PromptAssemblerService } from "./prompt-assembler.service";
import { RAG_FALLBACK_RESPONSE, RagAgentService } from "./rag-agent.service";
import { ResponseRecorderService } from "./response-recorder.service";
import { RetrievalService } from "./retrieval.service";

function createObservability(): ObservabilityService {
  return {
    log: jest.fn(),
    startSpan: jest.fn().mockReturnValue({
      setAttribute: jest.fn(),
      end: jest.fn(),
      recordException: jest.fn(),
      setStatus: jest.fn(),
      isRecording: () => true,
      spanContext: () => ({ traceId: "t", spanId: "s", traceFlags: 0 }),
      setAttributes: jest.fn(),
      addEvent: jest.fn(),
      updateName: jest.fn(),
    }),
    endSpanOk: jest.fn(),
    endSpanError: jest.fn(),
  } as unknown as ObservabilityService;
}

function createConfig(model?: string): ConfigService {
  return {
    get: (key: string) => (key === "llm.fallbackModel" ? model : undefined),
  } as unknown as ConfigService;
}

function createLlmClient(): LlmClient {
  return {
    providerId: "anthropic",
    supportsModel: () => true,
    createCompletion: jest.fn().mockResolvedValue({
      content: "Use Cisco AnyConnect.",
      model: "claude-sonnet-4-5",
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 20 },
    }),
    createCompletionStream: jest.fn().mockImplementation(
      () =>
        new Observable<LlmStreamChunk>((sub) => {
          sub.next({ id: "x", delta: "Use " });
          sub.next({ id: "x", delta: "Cisco AnyConnect." });
          sub.next({
            id: "x",
            delta: "",
            finishReason: "stop",
            usage: { inputTokens: 100, outputTokens: 20 },
          });
          sub.complete();
        }),
    ),
    listModels: () => Promise.resolve([]),
  };
}

function createRegistry(client: LlmClient): LlmRegistryService {
  return { resolveClient: () => client } as unknown as LlmRegistryService;
}

function createRetrieval(context: string | null): RetrievalService {
  return {
    getContext: jest.fn().mockResolvedValue(context),
  } as unknown as RetrievalService;
}

function createPromptAssembler(): PromptAssemblerService {
  return {
    buildMessages: jest.fn().mockReturnValue([
      { role: "system", content: "sys" },
      { role: "user", content: "u" },
    ]),
  } as unknown as PromptAssemblerService;
}

function createRecorder(): ResponseRecorderService {
  return {
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFallback: jest.fn().mockResolvedValue(undefined),
    recordError: jest.fn().mockResolvedValue(undefined),
  } as unknown as ResponseRecorderService;
}

function createSessions(
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): SessionService {
  return {
    getSession: jest.fn().mockResolvedValue({ messages: history, lastActivity: 0 }),
    appendMessages: jest.fn().mockResolvedValue(undefined),
  } as unknown as SessionService;
}

describe("RagAgentService", () => {
  describe("processMessage", () => {
    it("retrieves context, calls LLM and records success", async () => {
      const client = createLlmClient();
      const retrieval = createRetrieval("VPN docs");
      const recorder = createRecorder();
      const promptAssembler = createPromptAssembler();
      const svc = new RagAgentService(
        createRegistry(client),
        createObservability(),
        retrieval,
        promptAssembler,
        recorder,
        createSessions(),
        new AgentRegistryService(),
        createConfig("claude-sonnet-4-5-20250929"),
      );

      const result = await svc.processMessage({
        sessionId: "s1",
        userMessage: "How do I VPN?",
      });

      expect(retrieval.getContext).toHaveBeenCalledWith(
        "How do I VPN?",
        expect.objectContaining({ requestId: expect.stringContaining("s1-") }),
      );
      expect(client.createCompletion).toHaveBeenCalled();
      expect(result.content).toBe("Use Cisco AnyConnect.");
      expect(result.model).toBe("claude-sonnet-4-5");
      expect(recorder.recordSuccess).toHaveBeenCalled();
    });

    it("returns the fallback when retrieval yields no context", async () => {
      const client = createLlmClient();
      const retrieval = createRetrieval(null);
      const recorder = createRecorder();
      const svc = new RagAgentService(
        createRegistry(client),
        createObservability(),
        retrieval,
        createPromptAssembler(),
        recorder,
        createSessions(),
        new AgentRegistryService(),
        createConfig("model-x"),
      );

      const result = await svc.processMessage({
        sessionId: "s1",
        userMessage: "Trivia question.",
      });

      expect(result.content).toBe(RAG_FALLBACK_RESPONSE);
      expect(client.createCompletion).not.toHaveBeenCalled();
      expect(recorder.recordFallback).toHaveBeenCalled();
    });

    it("forwards allowedToolNames to the retrieval service", async () => {
      const retrieval = createRetrieval("ctx");
      const svc = new RagAgentService(
        createRegistry(createLlmClient()),
        createObservability(),
        retrieval,
        createPromptAssembler(),
        createRecorder(),
        createSessions(),
        new AgentRegistryService(),
        createConfig(),
      );
      await svc.processMessage({
        sessionId: "s1",
        userMessage: "x",
        allowedToolNames: ["fetch_url"],
      });
      expect(retrieval.getContext).toHaveBeenCalledWith(
        "x",
        expect.objectContaining({ allowedToolNames: ["fetch_url"] }),
      );
    });
  });

  describe("processMessageStream", () => {
    it("streams deltas from the LLM and records success on complete", async () => {
      const client = createLlmClient();
      const recorder = createRecorder();
      const svc = new RagAgentService(
        createRegistry(client),
        createObservability(),
        createRetrieval("ctx"),
        createPromptAssembler(),
        recorder,
        createSessions(),
        new AgentRegistryService(),
        createConfig(),
      );

      const chunks = await firstValueFrom(
        svc.processMessageStream({ sessionId: "s1", userMessage: "q" }).pipe(toArray()),
      );

      expect(chunks.map((c) => c.delta).join("")).toBe("Use Cisco AnyConnect.");
      expect(recorder.recordSuccess).toHaveBeenCalled();
    });

    it("emits the fallback chunk when context is null", async () => {
      const client = createLlmClient();
      const recorder = createRecorder();
      const svc = new RagAgentService(
        createRegistry(client),
        createObservability(),
        createRetrieval(null),
        createPromptAssembler(),
        recorder,
        createSessions(),
        new AgentRegistryService(),
        createConfig(),
      );

      const chunks = await firstValueFrom(
        svc.processMessageStream({ sessionId: "s1", userMessage: "trivia" }).pipe(toArray()),
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].delta).toBe(RAG_FALLBACK_RESPONSE);
      expect(chunks[0].finishReason).toBe("stop");
      expect(client.createCompletionStream).not.toHaveBeenCalled();
      expect(recorder.recordFallback).toHaveBeenCalled();
    });
  });
});
