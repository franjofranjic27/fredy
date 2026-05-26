import OpenAI from "openai";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { trace, Tracer } from "@opentelemetry/api";
import { Observable } from "rxjs";
import { LlmClient, LlmProviderId } from "../llm-client.interface";
import {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmCompletionStreamRequest,
  LlmError,
  LlmModelInfo,
  LlmStreamChunk,
} from "../llm.types";
import {
  addLlmContentEvent,
  setLlmRequestAttrs,
  setLlmResponseAttrs,
} from "../../observability/semconv";
import { OPENAI_DEFAULT_MODEL, OPENAI_MODELS, isOpenAIModel } from "./openai-models.constants";

@Injectable()
export class OpenAIClientService implements LlmClient {
  readonly providerId: LlmProviderId = "openai";
  private readonly logger = new Logger(OpenAIClientService.name);
  private readonly client: OpenAI | null;
  private readonly tracer: Tracer = trace.getTracer("fredy-agent.openai");
  private readonly defaultMaxTokens: number;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>("llm.openai.apiKey");
    const baseURL = config.get<string>("llm.openai.baseUrl");
    this.client = apiKey ? new OpenAI({ apiKey, baseURL: baseURL || undefined }) : null;
    this.defaultMaxTokens = config.get<number>("llm.openai.maxTokens") ?? 4096;
    if (!apiKey) {
      this.logger.warn(
        "OPENAI_API_KEY not set — OpenAIClientService is registered but will throw on use",
      );
    }
  }

  supportsModel(modelId: string): boolean {
    return isOpenAIModel(modelId);
  }

  async listModels(): Promise<LlmModelInfo[]> {
    return OPENAI_MODELS;
  }

  async createCompletion(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const client = this.requireClient();
    const model = request.model ?? OPENAI_DEFAULT_MODEL;
    const maxTokens = request.maxTokens ?? this.defaultMaxTokens;

    const span = this.tracer.startSpan("gen_ai.chat");
    setLlmRequestAttrs(span, {
      system: "openai",
      model,
      maxTokens,
      temperature: request.temperature,
    });
    for (const m of request.messages) addLlmContentEvent(span, m.role, m.content);

    try {
      const response = await client.chat.completions.create({
        model,
        max_completion_tokens: maxTokens,
        temperature: request.temperature,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
      const choice = response.choices[0];
      const content = choice?.message?.content ?? "";
      const result: LlmCompletionResponse = {
        content,
        model: response.model,
        responseId: response.id,
        finishReason: choice?.finish_reason ?? undefined,
        usage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
            }
          : undefined,
      };
      setLlmResponseAttrs(span, {
        responseId: result.responseId,
        responseModel: result.model,
        finishReason: result.finishReason,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      });
      addLlmContentEvent(span, "assistant", content);
      return result;
    } catch (error) {
      throw this.mapError(error, span);
    } finally {
      span.end();
    }
  }

  createCompletionStream(request: LlmCompletionStreamRequest): Observable<LlmStreamChunk> {
    return new Observable<LlmStreamChunk>((subscriber) => {
      const run = async () => {
        const client = this.requireClient();
        const model = request.model ?? OPENAI_DEFAULT_MODEL;
        const maxTokens = request.maxTokens ?? this.defaultMaxTokens;
        const id = `openai-${Date.now()}`;

        const span = this.tracer.startSpan("gen_ai.chat");
        setLlmRequestAttrs(span, {
          system: "openai",
          model,
          maxTokens,
          temperature: request.temperature,
        });
        for (const m of request.messages) addLlmContentEvent(span, m.role, m.content);

        try {
          const stream = await client.chat.completions.create({
            model,
            max_completion_tokens: maxTokens,
            temperature: request.temperature,
            messages: request.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            stream: true,
            stream_options: { include_usage: true },
          });

          let fullText = "";
          let finishReason: string | undefined;
          let responseId: string | undefined;
          let responseModel: string | undefined;
          let inputTokens: number | undefined;
          let outputTokens: number | undefined;

          for await (const chunk of stream) {
            responseId ??= chunk.id;
            responseModel ??= chunk.model;
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              subscriber.next({ id, delta });
            }
            const fr = chunk.choices[0]?.finish_reason;
            if (fr) finishReason = fr;
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens;
              outputTokens = chunk.usage.completion_tokens;
            }
          }

          setLlmResponseAttrs(span, {
            responseId,
            responseModel,
            finishReason,
            inputTokens,
            outputTokens,
          });
          addLlmContentEvent(span, "assistant", fullText);
          subscriber.next({
            id,
            delta: "",
            usage:
              inputTokens !== undefined && outputTokens !== undefined
                ? { inputTokens, outputTokens }
                : undefined,
            finishReason: finishReason ?? "stop",
            responseId,
          });
          subscriber.complete();
        } catch (error) {
          subscriber.error(this.mapError(error, span));
        } finally {
          span.end();
        }
      };
      void run();
    });
  }

  private requireClient(): OpenAI {
    if (!this.client) {
      throw new LlmError("UNAUTHORIZED", "OpenAI client not initialised (OPENAI_API_KEY missing)");
    }
    return this.client;
  }

  private mapError(error: unknown, span: { recordException: (e: Error) => void }): LlmError {
    if (error instanceof LlmError) {
      span.recordException(error);
      return error;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    span.recordException(err);
    if (err instanceof OpenAI.APIError && err.status === 429) {
      return new LlmError("RATE_LIMITED", err.message, error);
    }
    if (err instanceof OpenAI.APIError && err.status === 401) {
      return new LlmError("UNAUTHORIZED", err.message, error);
    }
    return new LlmError("API_ERROR", err.message, error);
  }
}
