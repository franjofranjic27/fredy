import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SpanStatusCode,
  trace,
  type Span,
  type SpanStatus,
  type Tracer,
  type TracerProvider,
} from "@opentelemetry/api";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolRegistry, type AgentRun } from "@fredy/agent-core";
import { loadConfig } from "../../config.js";
import { FakeChatModel } from "../../testing/fake-chat-model.js";
import { createTestLogger } from "../../testing/test-logger.js";
import type { VectorSearchHit } from "../../tools/pgvector.js";
import { createRagAgent, mapRagStreamEvents, type RagStreamEvent } from "./rag-agent.js";
import { RAG_FALLBACK_RESPONSE } from "./system-prompt.js";

async function collect(events: RagStreamEvent[]): Promise<string[]> {
  const stream = mapRagStreamEvents(
    (async function* () {
      for (const event of events) yield event;
    })(),
  );
  const out: string[] = [];
  for await (const delta of stream) out.push(delta);
  return out;
}

async function drain(run: AgentRun, userMessage: string): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of run.stream({
    sessionId: "s1",
    messages: [{ role: "user", content: userMessage }],
    userMessage,
  })) {
    out.push(delta);
  }
  return out;
}

describe("mapRagStreamEvents (streamEvents → SSE mapping)", () => {
  it("forwards streamed model tokens and suppresses the duplicate generate emission", async () => {
    const deltas = await collect([
      { event: "on_chat_model_stream", data: { chunk: { content: "VPN-" } } },
      { event: "on_chat_model_stream", data: { chunk: { content: "Setup" } } },
      // Would double-emit the whole answer without the guard:
      { event: "on_chain_end", name: "generate", data: { output: { answer: "VPN-Setup" } } },
    ]);
    expect(deltas).toEqual(["VPN-", "Setup"]);
    expect(deltas.join("")).toBe("VPN-Setup");
  });

  it("emits the whole answer once for providers that do not stream tokens", async () => {
    const deltas = await collect([
      { event: "on_chain_end", name: "generate", data: { output: { answer: "whole answer" } } },
    ]);
    expect(deltas).toEqual(["whole answer"]);
  });

  it("dispatches the refuse node as the verbatim fallback response", async () => {
    const deltas = await collect([{ event: "on_chain_end", name: "refuse", data: { output: {} } }]);
    expect(deltas).toEqual([RAG_FALLBACK_RESPONSE]);
  });

  it("ignores empty token chunks and unrelated events", async () => {
    const deltas = await collect([
      { event: "on_chat_model_stream", data: { chunk: { content: "" } } },
      { event: "on_chain_start", name: "generate" },
      { event: "on_chain_end", name: "retrieve", data: { output: {} } },
    ]);
    expect(deltas).toEqual([]);
  });

  it("flattens content-block token chunks to text", async () => {
    const deltas = await collect([
      {
        event: "on_chat_model_stream",
        data: { chunk: { content: [{ type: "text", text: "x" }] } },
      },
    ]);
    expect(deltas).toEqual(["x"]);
  });
});

interface RecordedSpan {
  readonly name: string;
  statusCode?: SpanStatusCode;
  ended: boolean;
}

/**
 * Minimal recording TracerProvider built on @opentelemetry/api alone (the agent
 * package has no tracing SDK) — captures span names, final status and end calls.
 */
function installRecordingTracer(): RecordedSpan[] {
  const recorded: RecordedSpan[] = [];
  const makeSpan = (name: string): Span => {
    const record: RecordedSpan = { name, ended: false };
    recorded.push(record);
    const span: Partial<Span> = {
      setAttribute: () => span as Span,
      setAttributes: () => span as Span,
      addEvent: () => span as Span,
      addLink: () => span as Span,
      addLinks: () => span as Span,
      recordException: () => undefined,
      updateName: () => span as Span,
      isRecording: () => true,
      spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 1 }),
      setStatus: (status: SpanStatus) => {
        record.statusCode = status.code;
        return span as Span;
      },
      end: () => {
        record.ended = true;
      },
    };
    return span as Span;
  };
  const tracer: Partial<Tracer> = { startSpan: (name: string) => makeSpan(name) };
  const provider: TracerProvider = { getTracer: () => tracer as Tracer };
  trace.setGlobalTracerProvider(provider);
  return recorded;
}

describe("rag agent stream()", () => {
  let recorded: RecordedSpan[];

  beforeAll(() => {
    recorded = installRecordingTracer();
  });

  afterAll(() => {
    trace.disable();
  });

  function registryWithVectorSearch(content: string, hits: VectorSearchHit[]): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register(
      tool(async (): Promise<[string, { hits: VectorSearchHit[] }]> => [content, { hits }], {
        name: "vector_search",
        description: "stub",
        schema: z.object({
          query: z.string(),
          limit: z.number().optional(),
          spaceKey: z.string().optional(),
        }),
        responseFormat: "content_and_artifact",
      }),
    );
    return registry;
  }

  function buildRun(model: FakeChatModel, registry: ToolRegistry): AgentRun {
    const config = loadConfig({ AGENT_ALLOW_ANONYMOUS: "true" });
    return createRagAgent().createRun({
      config,
      toolRegistry: registry,
      reranker: null,
      logger: createTestLogger().logger,
      createModel: () => model,
    });
  }

  const hit: VectorSearchHit = {
    id: "1",
    score: 0.9,
    payload: { title: "VPN", content: "Install Cisco AnyConnect", url: "https://wiki/vpn" },
  };

  it("streams model tokens grounded in retrieval without re-emitting the answer", async () => {
    const model = new FakeChatModel({ response: "VPN-Setup", chunks: ["VPN-", "Setup"] });
    const run = buildRun(model, registryWithVectorSearch("VPN docs", [hit]));
    const deltas = await drain(run, "How do I set up VPN?");
    expect(deltas.join("")).toBe("VPN-Setup");
    // No duplicate whole-answer delta appended after the streamed tokens.
    expect(deltas.filter((delta) => delta === "VPN-Setup")).toHaveLength(0);
  });

  it("streams the verbatim refusal when retrieval yields nothing", async () => {
    const model = new FakeChatModel({ response: "unused" });
    const run = buildRun(model, new ToolRegistry());
    const deltas = await drain(run, "unknown topic");
    expect(deltas).toEqual([RAG_FALLBACK_RESPONSE]);
  });

  it("ends the agent.run span with error status when generation fails", async () => {
    recorded.length = 0;
    const model = new FakeChatModel({ failWith: new Error("model exploded") });
    const run = buildRun(model, registryWithVectorSearch("VPN docs", [hit]));
    await expect(drain(run, "How do I set up VPN?")).rejects.toThrow("model exploded");

    const agentSpan = recorded.find((span) => span.name === "agent.run");
    expect(agentSpan).toBeDefined();
    expect(agentSpan?.ended).toBe(true);
    expect(agentSpan?.statusCode).toBe(SpanStatusCode.ERROR);
  });

  // NOTE: asserting LLM/tool spans parent under the streaming agent.run span
  // requires an AsyncLocalStorage context manager, which is not registered in
  // this unit environment. The parenting itself is implemented via
  // withActiveSpanContext (mirroring invoke()'s otelContext.with) and is
  // exercised end-to-end when the service boots with tracing enabled.
});
