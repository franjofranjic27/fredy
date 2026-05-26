import Anthropic from "@anthropic-ai/sdk";
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
import {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MODELS,
  isAnthropicModel,
} from "./anthropic-models.constants";

@Injectable()
export class AnthropicClientService implements LlmClient {
  readonly providerId: LlmProviderId = "anthropic";
  private readonly logger = new Logger(AnthropicClientService.name);
  private readonly client: Anthropic | null;
  private readonly tracer: Tracer = trace.getTracer("fredy-agent.anthropic");
  private readonly defaultMaxTokens: number;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>("llm.anthropic.apiKey");
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.defaultMaxTokens = config.get<number>("llm.anthropic.maxTokens") ?? 4096;
    if (!apiKey) {
      this.logger.warn(
        "ANTHROPIC_API_KEY not set — AnthropicClientService is registered but will throw on use",
      );
    }
  }

  supportsModel(modelId: string): boolean {
    return isAnthropicModel(modelId);
  }

  async listModels(): Promise<LlmModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  async createCompletion(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const client = this.requireClient();
    const model = request.model ?? ANTHROPIC_DEFAULT_MODEL;
    const { system, messages } = splitSystem(request.messages);
    const maxTokens = request.maxTokens ?? this.defaultMaxTokens;

    const span = this.tracer.startSpan("gen_ai.chat");
    setLlmRequestAttrs(span, {
      system: "anthropic",
      model,
      maxTokens,
      temperature: request.temperature,
    });
    for (const m of request.messages) addLlmContentEvent(span, m.role, m.content);

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: request.temperature,
        system: system ?? undefined,
        messages,
      });
      const content = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      const result: LlmCompletionResponse = {
        content,
        model: response.model,
        responseId: response.id,
        finishReason: response.stop_reason ?? undefined,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
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
        const model = request.model ?? ANTHROPIC_DEFAULT_MODEL;
        const { system, messages } = splitSystem(request.messages);
        const maxTokens = request.maxTokens ?? this.defaultMaxTokens;
        const id = `anthropic-${Date.now()}`;

        const span = this.tracer.startSpan("gen_ai.chat");
        setLlmRequestAttrs(span, {
          system: "anthropic",
          model,
          maxTokens,
          temperature: request.temperature,
        });
        for (const m of request.messages) addLlmContentEvent(span, m.role, m.content);

        try {
          const stream = client.messages.stream({
            model,
            max_tokens: maxTokens,
            temperature: request.temperature,
            system: system ?? undefined,
            messages,
          });
          let fullText = "";
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              fullText += event.delta.text;
              subscriber.next({ id, delta: event.delta.text });
            }
          }
          const final = await stream.finalMessage();
          const usage = {
            inputTokens: final.usage.input_tokens,
            outputTokens: final.usage.output_tokens,
          };
          setLlmResponseAttrs(span, {
            responseId: final.id,
            responseModel: final.model,
            finishReason: final.stop_reason ?? undefined,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          });
          addLlmContentEvent(span, "assistant", fullText);
          subscriber.next({
            id,
            delta: "",
            usage,
            finishReason: final.stop_reason ?? "stop",
            responseId: final.id,
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

  private requireClient(): Anthropic {
    if (!this.client) {
      throw new LlmError(
        "UNAUTHORIZED",
        "Anthropic client not initialised (ANTHROPIC_API_KEY missing)",
      );
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
    if (err.message.toLowerCase().includes("rate")) {
      return new LlmError("RATE_LIMITED", err.message, error);
    }
    return new LlmError("API_ERROR", err.message, error);
  }
}

function splitSystem(messages: LlmMessage[]): {
  system: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systems = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system") as Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  return {
    system: systems.length > 0 ? systems.map((s) => s.content).join("\n\n") : null,
    messages: rest,
  };
}
