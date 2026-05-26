import { GoogleGenAI, Content } from "@google/genai";
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
  LlmMessage,
  LlmModelInfo,
  LlmStreamChunk,
} from "../llm.types";
import {
  addLlmContentEvent,
  setLlmRequestAttrs,
  setLlmResponseAttrs,
} from "../../observability/semconv";
import { GEMINI_DEFAULT_MODEL, GEMINI_MODELS, isGeminiModel } from "./gemini-models.constants";

@Injectable()
export class GeminiClientService implements LlmClient {
  readonly providerId: LlmProviderId = "google.gemini";
  private readonly logger = new Logger(GeminiClientService.name);
  private readonly client: GoogleGenAI | null;
  private readonly tracer: Tracer = trace.getTracer("fredy-agent.gemini");
  private readonly defaultMaxTokens: number;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>("llm.gemini.apiKey");
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    this.defaultMaxTokens = config.get<number>("llm.gemini.maxTokens") ?? 4096;
    if (!apiKey) {
      this.logger.warn(
        "GEMINI_API_KEY not set — GeminiClientService is registered but will throw on use",
      );
    }
  }

  supportsModel(modelId: string): boolean {
    return isGeminiModel(modelId);
  }

  async listModels(): Promise<LlmModelInfo[]> {
    return GEMINI_MODELS;
  }

  async createCompletion(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const client = this.requireClient();
    const model = request.model ?? GEMINI_DEFAULT_MODEL;
    const { systemInstruction, contents } = toGeminiContents(request.messages);
    const maxTokens = request.maxTokens ?? this.defaultMaxTokens;

    const span = this.tracer.startSpan("gen_ai.chat");
    setLlmRequestAttrs(span, {
      system: "google.gemini",
      model,
      maxTokens,
      temperature: request.temperature,
    });
    for (const m of request.messages) addLlmContentEvent(span, m.role, m.content);

    try {
      const response = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: systemInstruction || undefined,
          maxOutputTokens: maxTokens,
          temperature: request.temperature,
        },
      });
      const content = response.text ?? "";
      const usage = response.usageMetadata
        ? {
            inputTokens: response.usageMetadata.promptTokenCount ?? 0,
            outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
          }
        : undefined;
      const finishReason = response.candidates?.[0]?.finishReason;
      const result: LlmCompletionResponse = {
        content,
        model,
        finishReason: finishReason ? String(finishReason).toLowerCase() : undefined,
        usage,
      };
      setLlmResponseAttrs(span, {
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
        const model = request.model ?? GEMINI_DEFAULT_MODEL;
        const { systemInstruction, contents } = toGeminiContents(request.messages);
        const maxTokens = request.maxTokens ?? this.defaultMaxTokens;
        const id = `gemini-${Date.now()}`;

        const span = this.tracer.startSpan("gen_ai.chat");
        setLlmRequestAttrs(span, {
          system: "google.gemini",
          model,
          maxTokens,
          temperature: request.temperature,
        });
        for (const m of request.messages) addLlmContentEvent(span, m.role, m.content);

        try {
          const stream = await client.models.generateContentStream({
            model,
            contents,
            config: {
              systemInstruction: systemInstruction || undefined,
              maxOutputTokens: maxTokens,
              temperature: request.temperature,
            },
          });

          let fullText = "";
          let finishReason: string | undefined;
          let inputTokens: number | undefined;
          let outputTokens: number | undefined;

          for await (const chunk of stream) {
            const text = chunk.text ?? "";
            if (text) {
              fullText += text;
              subscriber.next({ id, delta: text });
            }
            const fr = chunk.candidates?.[0]?.finishReason;
            if (fr) finishReason = String(fr).toLowerCase();
            if (chunk.usageMetadata) {
              inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
              outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
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

  private requireClient(): GoogleGenAI {
    if (!this.client) {
      throw new LlmError("UNAUTHORIZED", "Gemini client not initialised (GEMINI_API_KEY missing)");
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
    if (err.message.toLowerCase().includes("rate") || err.message.includes("429")) {
      return new LlmError("RATE_LIMITED", err.message, error);
    }
    return new LlmError("API_ERROR", err.message, error);
  }
}

function toGeminiContents(messages: LlmMessage[]): {
  systemInstruction: string;
  contents: Content[];
} {
  const systems: string[] = [];
  const contents: Content[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systems.push(m.content);
      continue;
    }
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  return { systemInstruction: systems.join("\n\n"), contents };
}
