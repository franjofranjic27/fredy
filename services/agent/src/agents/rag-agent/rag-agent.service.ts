import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Observable, Observer } from "rxjs";
import { LlmRegistryService } from "../../shared/llm/llm-registry.service";
import { LlmStreamChunk } from "../../shared/llm/llm.types";
import { SessionService } from "../../shared/memory/session/session.service";
import { ObservabilityService } from "../../shared/observability/observability.service";
import { AGENT } from "../../shared/observability/semconv";
import { PromptAssemblerService } from "./prompt-assembler.service";
import { ResponseRecorderService } from "./response-recorder.service";
import { RetrievalService } from "./retrieval.service";

const FALLBACK_RESPONSE =
  "I'm sorry, I don't know the answer to that question. The relevant documentation may not be indexed in the knowledge base, or my access to it was restricted.";

export interface RagAgentRequest {
  sessionId: string;
  userMessage: string;
  model?: string;
  allowedToolNames?: string[];
  spaceKey?: string;
}

export interface RagAgentResponse {
  content: string;
  model: string;
}

@Injectable()
export class RagAgentService {
  private readonly logger = new Logger(RagAgentService.name);
  private readonly defaultModel: string | undefined;

  constructor(
    private readonly llmRegistry: LlmRegistryService,
    private readonly observability: ObservabilityService,
    private readonly retrieval: RetrievalService,
    private readonly promptAssembler: PromptAssemblerService,
    private readonly recorder: ResponseRecorderService,
    private readonly sessions: SessionService,
    config: ConfigService,
  ) {
    this.defaultModel = config.get<string>("llm.fallbackModel");
  }

  async processMessage(request: RagAgentRequest): Promise<RagAgentResponse> {
    const startedAt = Date.now();
    const requestId = `${request.sessionId}-${startedAt}`;
    const span = this.observability.startSpan("agent.run", requestId, "rag-agent");
    span.setAttribute(AGENT.NAME, "rag-agent");
    span.setAttribute(AGENT.SESSION_ID, request.sessionId);

    try {
      const session = await this.sessions.getSession(request.sessionId);
      const context = await this.retrieval.getContext(request.userMessage, {
        requestId,
        allowedToolNames: request.allowedToolNames,
        spaceKey: request.spaceKey,
      });

      const requestedModel = request.model ?? this.defaultModel;

      if (context === null) {
        const model = requestedModel ?? "unknown";
        await this.recorder.recordFallback(
          request.sessionId,
          requestId,
          model,
          request.userMessage,
          FALLBACK_RESPONSE,
          startedAt,
        );
        return { content: FALLBACK_RESPONSE, model };
      }

      const client = this.llmRegistry.resolveClient(requestedModel);
      const messages = this.promptAssembler.buildMessages(
        session?.messages ?? [],
        request.userMessage,
        context,
      );

      const response = await client.createCompletion({
        messages,
        model: requestedModel,
      });

      await this.recorder.recordSuccess(
        request.sessionId,
        requestId,
        response.model,
        request.userMessage,
        response.content,
        startedAt,
        response.usage,
      );

      return { content: response.content, model: response.model };
    } finally {
      this.observability.endSpanOk(span);
    }
  }

  processMessageStream(request: RagAgentRequest): Observable<LlmStreamChunk> {
    return new Observable<LlmStreamChunk>((subscriber) => {
      void this.runStream(request, subscriber).catch((err) => subscriber.error(err));
    });
  }

  private async runStream(
    request: RagAgentRequest,
    subscriber: Observer<LlmStreamChunk>,
  ): Promise<void> {
    const startedAt = Date.now();
    const requestId = `${request.sessionId}-${startedAt}`;
    const span = this.observability.startSpan("agent.run", requestId, "rag-agent");
    span.setAttribute(AGENT.NAME, "rag-agent");
    span.setAttribute(AGENT.SESSION_ID, request.sessionId);

    try {
      const session = await this.sessions.getSession(request.sessionId);
      const context = await this.retrieval.getContext(request.userMessage, {
        requestId,
        allowedToolNames: request.allowedToolNames,
        spaceKey: request.spaceKey,
      });

      const requestedModel = request.model ?? this.defaultModel;

      if (context === null) {
        const model = requestedModel ?? "unknown";
        await this.recorder.recordFallback(
          request.sessionId,
          requestId,
          model,
          request.userMessage,
          FALLBACK_RESPONSE,
          startedAt,
        );
        subscriber.next({
          id: `rag-${Date.now()}`,
          delta: FALLBACK_RESPONSE,
          finishReason: "stop",
        });
        subscriber.complete();
        return;
      }

      const client = this.llmRegistry.resolveClient(requestedModel);
      const messages = this.promptAssembler.buildMessages(
        session?.messages ?? [],
        request.userMessage,
        context,
      );

      let fullContent = "";
      let lastChunk: LlmStreamChunk | undefined;
      const stream$ = client.createCompletionStream({
        messages,
        model: requestedModel,
        stream: true,
      });

      stream$.subscribe({
        next: (chunk) => {
          if (chunk.delta) fullContent += chunk.delta;
          lastChunk = chunk;
          subscriber.next(chunk);
        },
        error: (err) => {
          void this.recorder.recordError(
            request.sessionId,
            requestId,
            requestedModel ?? "unknown",
            request.userMessage,
            fullContent,
            startedAt,
            err,
          );
          subscriber.error(err);
        },
        complete: () => {
          void this.recorder.recordSuccess(
            request.sessionId,
            requestId,
            requestedModel ?? lastChunk?.responseId ?? "unknown",
            request.userMessage,
            fullContent,
            startedAt,
            lastChunk?.usage,
          );
          subscriber.complete();
        },
      });
    } finally {
      this.observability.endSpanOk(span);
    }
  }
}

export const RAG_FALLBACK_RESPONSE = FALLBACK_RESPONSE;
