import { Injectable, Logger } from "@nestjs/common";
import { ObservabilityService } from "../../shared/observability/observability.service";
import { SessionService } from "../../shared/memory/session/session.service";

@Injectable()
export class ResponseRecorderService {
  private readonly logger = new Logger(ResponseRecorderService.name);

  constructor(
    private readonly observability: ObservabilityService,
    private readonly sessions: SessionService,
  ) {}

  async recordSuccess(
    sessionId: string,
    requestId: string,
    model: string,
    userMessage: string,
    response: string,
    startedAt: number,
    usage?: { inputTokens?: number; outputTokens?: number },
  ): Promise<void> {
    await this.sessions.appendMessages(sessionId, [
      { role: "user", content: userMessage },
      { role: "assistant", content: response },
    ]);
    this.observability.log({
      type: "request",
      agent: "rag-agent",
      sessionId,
      requestId,
      model,
      durationMs: Date.now() - startedAt,
      finishReason: "stop",
    });
    if (usage) {
      this.observability.log({
        type: "llm-call",
        agent: "rag-agent",
        sessionId,
        requestId,
        provider: providerFromModel(model),
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  async recordFallback(
    sessionId: string,
    requestId: string,
    model: string,
    userMessage: string,
    response: string,
    startedAt: number,
  ): Promise<void> {
    await this.sessions.appendMessages(sessionId, [
      { role: "user", content: userMessage },
      { role: "assistant", content: response },
    ]);
    this.observability.log({
      type: "request",
      agent: "rag-agent",
      sessionId,
      requestId,
      model,
      durationMs: Date.now() - startedAt,
      finishReason: "fallback",
    });
  }

  async recordError(
    sessionId: string,
    requestId: string,
    model: string,
    userMessage: string,
    partialResponse: string,
    startedAt: number,
    error: unknown,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (partialResponse) {
      await this.sessions.appendMessages(sessionId, [
        { role: "user", content: userMessage },
        { role: "assistant", content: partialResponse },
      ]);
    }
    this.observability.log({
      type: "request",
      agent: "rag-agent",
      sessionId,
      requestId,
      model,
      durationMs: Date.now() - startedAt,
      finishReason: "error",
      error: errorMessage,
    });
  }
}

function providerFromModel(model: string): "anthropic" | "openai" | "google.gemini" | "ollama" {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "google.gemini";
  if (
    model.startsWith("gpt-") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  ) {
    return "openai";
  }
  return "ollama";
}
