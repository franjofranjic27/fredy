import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Request, Response } from "express";
import { RagAgentService } from "../../agents/rag-agent/rag-agent.service";
import { LlmRegistryService } from "../../shared/llm/llm-registry.service";
import { LlmStreamChunk } from "../../shared/llm/llm.types";
import {
  ChatCompletionRequestSchema,
  createCompletionChunk,
  createCompletionResponse,
} from "../../shared/openai/openai-types";
import { AGENT_MODEL_ID, ResolvedChatRequest } from "./web.types";

interface RbacRequest extends Request {
  allowedToolNames?: string[];
  resolvedRole?: string;
}

@Injectable()
export class WebService {
  private readonly logger = new Logger(WebService.name);

  constructor(
    private readonly ragAgent: RagAgentService,
    private readonly llmRegistry: LlmRegistryService,
  ) {}

  async listModels(): Promise<{
    object: "list";
    data: Array<{ id: string; object: "model"; created: number; owned_by: string }>;
  }> {
    const providerModels = await this.llmRegistry.listAllModels();
    const created = Math.floor(Date.now() / 1000);
    return {
      object: "list",
      data: [
        {
          id: AGENT_MODEL_ID,
          object: "model" as const,
          created,
          owned_by: "fredy",
        },
        ...providerModels.map((m) => ({
          id: m.id,
          object: m.object,
          created,
          owned_by: m.owned_by,
        })),
      ],
    };
  }

  async handleChatCompletion(req: RbacRequest, res: Response, body: unknown): Promise<void> {
    const resolved = this.resolve(req, body, res);
    if (!resolved) return;

    res.setHeader("x-session-id", resolved.sessionId);

    if (resolved.stream) {
      this.streamChatCompletion(resolved, res);
      return;
    }

    await this.sendChatCompletion(resolved, res);
  }

  private async sendChatCompletion(resolved: ResolvedChatRequest, res: Response): Promise<void> {
    try {
      const result = await this.ragAgent.processMessage({
        sessionId: resolved.sessionId,
        userMessage: resolved.userMessage,
        model: this.resolveAgentModel(resolved.model),
        allowedToolNames: resolved.allowedToolNames,
      });
      res.status(200).json(createCompletionResponse(result.content, resolved.model));
    } catch (error) {
      this.respondWithError(res, error, resolved.sessionId);
    }
  }

  private streamChatCompletion(resolved: ResolvedChatRequest, res: Response): void {
    const streamId = `chatcmpl-${randomUUID()}`;
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Initial role chunk so clients know a message is starting.
    res.write(
      `data: ${JSON.stringify(createCompletionChunk(streamId, "", null, resolved.model))}\n\n`,
    );

    const stream$ = this.ragAgent.processMessageStream({
      sessionId: resolved.sessionId,
      userMessage: resolved.userMessage,
      model: this.resolveAgentModel(resolved.model),
      allowedToolNames: resolved.allowedToolNames,
    });

    const subscription = stream$.subscribe({
      next: (chunk: LlmStreamChunk) => {
        if (!chunk.delta) return;
        res.write(
          `data: ${JSON.stringify(createCompletionChunk(streamId, chunk.delta, null, resolved.model))}\n\n`,
        );
      },
      error: (err: unknown) => {
        this.logger.error(
          `Stream error for session=${resolved.sessionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        res.write(
          `data: ${JSON.stringify({
            error: {
              message: err instanceof Error ? err.message : String(err),
              code: "STREAM_ERROR",
            },
          })}\n\n`,
        );
        res.end();
      },
      complete: () => {
        res.write(
          `data: ${JSON.stringify(createCompletionChunk(streamId, null, "stop", resolved.model))}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      },
    });

    res.on("close", () => {
      subscription.unsubscribe();
    });
  }

  private resolve(req: RbacRequest, body: unknown, res: Response): ResolvedChatRequest | null {
    const parsed = ChatCompletionRequestSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({
        error: { message: "Invalid request", details: parsed.error.issues },
      });
      return null;
    }
    const { messages, stream, model } = parsed.data;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      res.status(400).json({ error: { message: "No user message found" } });
      return null;
    }
    const sessionId = (req.header("x-session-id") as string | undefined) ?? randomUUID();
    return {
      sessionId,
      model: model ?? AGENT_MODEL_ID,
      stream: Boolean(stream),
      userMessage: lastUser.content,
      allowedToolNames: req.allowedToolNames,
    };
  }

  /**
   * The public-facing OpenAI-compatible model ID ("fredy-it-agent") does not
   * map to any LLM provider. When the client uses it, we let the registry
   * pick its configured fallback model.
   */
  private resolveAgentModel(requestedModel: string): string | undefined {
    return requestedModel === AGENT_MODEL_ID ? undefined : requestedModel;
  }

  private respondWithError(res: Response, error: unknown, sessionId: string): void {
    this.logger.error(
      `Request failed session=${sessionId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    res.status(500).json({
      error: {
        message: error instanceof Error ? error.message : "Internal server error",
        code: "AGENT_ERROR",
      },
    });
  }
}
