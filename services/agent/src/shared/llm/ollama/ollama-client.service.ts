import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { trace, Tracer } from "@opentelemetry/api";
import { Ollama } from "ollama";
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
import { OLLAMA_DEFAULT_MODEL, buildOllamaModelInfo } from "./ollama-models.constants";

@Injectable()
export class OllamaClientService implements LlmClient {
  readonly providerId: LlmProviderId = "ollama";
  private readonly logger = new Logger(OllamaClientService.name);
  private readonly client: Ollama;
  private readonly tracer: Tracer = trace.getTracer("fredy-agent.ollama");
  private readonly defaultModel: string;
  private readonly explicitModels: string[];

  constructor(config: ConfigService) {
    const host = config.get<string>("llm.ollama.baseUrl") ?? "http://localhost:11434";
    this.client = new Ollama({ host });
    this.defaultModel = config.get<string>("llm.ollama.model") ?? OLLAMA_DEFAULT_MODEL;
    const csv = config.get<string>("llm.ollama.models") ?? "";
    this.explicitModels = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  supportsModel(modelId: string): boolean {
    if (this.explicitModels.length > 0) return this.explicitModels.includes(modelId);
    return modelId === this.defaultModel || modelId.startsWith("ollama:");
  }

  async listModels(): Promise<LlmModelInfo[]> {
    try {
      const list = await this.client.list();
      return list.models.map((m) => buildOllamaModelInfo(m.name));
    } catch (error) {
      this.logger.warn(`Ollama list failed: ${(error as Error).message}`);
      return [buildOllamaModelInfo(this.defaultModel)];
    }
  }

  async createCompletion(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const model = request.model ?? this.defaultModel;
    const span = this.tracer.startSpan("gen_ai.chat");
    setLlmRequestAttrs(span, {
      system: "ollama",
      model,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
    });
    for (const m of request.messages) addLlmContentEvent(span, m.role, m.content);

    try {
      const response = await this.client.chat({
        model,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: { temperature: request.temperature, num_predict: request.maxTokens },
      });

      const content = response.message?.content ?? "";
      const usage = {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
      };
      const result: LlmCompletionResponse = {
        content,
        model: response.model,
        finishReason: response.done ? (response.done_reason ?? "stop") : undefined,
        usage,
      };
      setLlmResponseAttrs(span, {
        responseModel: result.model,
        finishReason: result.finishReason,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
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
        const model = request.model ?? this.defaultModel;
        const id = `ollama-${Date.now()}`;
        const span = this.tracer.startSpan("gen_ai.chat");
        setLlmRequestAttrs(span, {
          system: "ollama",
          model,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
        });
        for (const m of request.messages) addLlmContentEvent(span, m.role, m.content);

        try {
          const stream = await this.client.chat({
            model,
            messages: request.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            stream: true,
            options: {
              temperature: request.temperature,
              num_predict: request.maxTokens,
            },
          });

          let fullText = "";
          let finishReason: string | undefined;
          let inputTokens: number | undefined;
          let outputTokens: number | undefined;

          for await (const chunk of stream) {
            const text = chunk.message?.content ?? "";
            if (text) {
              fullText += text;
              subscriber.next({ id, delta: text });
            }
            if (chunk.done) {
              finishReason = chunk.done_reason ?? "stop";
              inputTokens = chunk.prompt_eval_count ?? inputTokens;
              outputTokens = chunk.eval_count ?? outputTokens;
            }
          }

          setLlmResponseAttrs(span, {
            responseModel: model,
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

  private mapError(error: unknown, span: { recordException: (e: Error) => void }): LlmError {
    if (error instanceof LlmError) {
      span.recordException(error);
      return error;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    span.recordException(err);
    return new LlmError("API_ERROR", err.message, error);
  }
}
