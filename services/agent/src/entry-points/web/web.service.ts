import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Request, Response } from "express";
import { AgentRegistryService } from "../../shared/agents/agent-registry.service";
import { Agent } from "../../shared/agents/agent.interface";
import { LlmStreamChunk } from "../../shared/llm/llm.types";
import {
  ChatCompletionRequestSchema,
  createCompletionChunk,
  createCompletionResponse,
} from "../../shared/openai/openai-types";
import { ResolvedChatRequest } from "./web.types";

interface RbacRequest extends Request {
  allowedToolNames?: string[];
  resolvedRole?: string;
}

@Injectable()
export class WebService {
  private readonly logger = new Logger(WebService.name);

  constructor(private readonly agents: AgentRegistryService) {}

  listModels(): {
    object: "list";
    data: Array<{ id: string; object: "model"; created: number; owned_by: string }>;
  } {
    const created = Math.floor(Date.now() / 1000);
    return {
      object: "list",
      data: this.agents.list().map((a) => ({
        id: a.descriptor.id,
        object: "model" as const,
        created,
        owned_by: a.descriptor.ownedBy ?? "fredy",
      })),
    };
  }

  async handleChatCompletion(req: RbacRequest, res: Response, body: unknown): Promise<void> {
    const resolved = this.resolve(req, body, res);
    if (!resolved) return;

    const agent = this.agents.get(resolved.model);
    if (!agent) {
      throw new BadRequestException(
        `Unknown model "${resolved.model}". Available agents: ${this.agents.listIds().join(", ")}`,
      );
    }

    res.setHeader("x-session-id", resolved.sessionId);

    if (resolved.stream) {
      this.streamChatCompletion(agent, resolved, res);
      return;
    }

    await this.sendChatCompletion(agent, resolved, res);
  }

  private async sendChatCompletion(
    agent: Agent,
    resolved: ResolvedChatRequest,
    res: Response,
  ): Promise<void> {
    try {
      const result = await agent.processMessage({
        sessionId: resolved.sessionId,
        userMessage: resolved.userMessage,
        allowedToolNames: resolved.allowedToolNames,
      });
      res.status(200).json(createCompletionResponse(result.content, resolved.model));
    } catch (error) {
      this.respondWithError(res, error, resolved.sessionId);
    }
  }

  private streamChatCompletion(agent: Agent, resolved: ResolvedChatRequest, res: Response): void {
    const streamId = `chatcmpl-${randomUUID()}`;
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    res.write(
      `data: ${JSON.stringify(createCompletionChunk(streamId, "", null, resolved.model))}\n\n`,
    );

    const stream$ = agent.processMessageStream({
      sessionId: resolved.sessionId,
      userMessage: resolved.userMessage,
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
    const defaultAgentId = this.agents.list()[0]?.descriptor.id;
    if (!model && !defaultAgentId) {
      res.status(400).json({ error: { message: "No model specified and no agents registered" } });
      return null;
    }
    return {
      sessionId,
      model: model ?? defaultAgentId!,
      stream: Boolean(stream),
      userMessage: lastUser.content,
      allowedToolNames: req.allowedToolNames,
    };
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
