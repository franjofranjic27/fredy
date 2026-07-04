import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, preHandlerAsyncHookHandler } from "fastify";
import type { AgentRegistry, AgentRunInput, Logger, RegisteredAgent } from "@fredy/agent-core";
import {
  ChatCompletionRequestSchema,
  createCompletionChunk,
  createCompletionResponse,
  createUsageChunk,
  type ChatCompletionRequest,
} from "../openai/types.js";
import type { RbacRequest } from "../plugins/rbac.js";

export interface ChatCompletionsRouteOptions {
  readonly agents: AgentRegistry;
  readonly logger: Logger;
  readonly preHandlers: preHandlerAsyncHookHandler[];
}

interface ResolvedChatRequest {
  readonly sessionId: string;
  readonly model: string;
  readonly stream: boolean;
  readonly includeUsage: boolean;
  readonly input: AgentRunInput;
}

export function registerChatCompletionsRoute(
  app: FastifyInstance,
  options: ChatCompletionsRouteOptions,
): void {
  const { agents, logger } = options;

  app.post("/v1/chat/completions", { preHandler: options.preHandlers }, async (request, reply) => {
    // Abort in-flight LLM/tool calls when the client goes away — every orphaned
    // completion otherwise runs to the end and costs real tokens.
    const abortController = new AbortController();
    request.raw.on("close", () => {
      if (request.raw.destroyed) abortController.abort();
    });

    const resolved = resolve(request as RbacRequest, reply, abortController.signal);
    if (!resolved) return;

    const agent = agents.get(resolved.model);
    if (!agent) {
      void reply.code(400).send({
        statusCode: 400,
        message: `Unknown model "${resolved.model}". Available agents: ${agents.listIds().join(", ")}`,
        error: "Bad Request",
      });
      return;
    }

    if (resolved.stream) {
      await streamChatCompletion(agent, resolved, reply, logger);
      return;
    }

    void reply.header("x-session-id", resolved.sessionId);
    try {
      const result = await agent.run.invoke(resolved.input);
      void reply
        .code(200)
        .send(createCompletionResponse(result.content, resolved.model, result.usage));
    } catch (error) {
      if (abortController.signal.aborted) {
        logger.debug(`Request aborted by client session=${resolved.sessionId}`);
        return;
      }
      logger.error(
        { err: error },
        `Request failed session=${resolved.sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      void reply.code(500).send({
        error: {
          message: error instanceof Error ? error.message : "Internal server error",
          code: "AGENT_ERROR",
        },
      });
    }
  });

  function resolve(
    request: RbacRequest,
    reply: FastifyReply,
    signal: AbortSignal,
  ): ResolvedChatRequest | null {
    const parsed = ChatCompletionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      void reply.code(400).send({
        error: { message: "Invalid request", details: parsed.error.issues },
      });
      return null;
    }
    const body: ChatCompletionRequest = parsed.data;
    const lastUser = [...body.messages].reverse().find((message) => message.role === "user");
    if (!lastUser) {
      void reply.code(400).send({ error: { message: "No user message found" } });
      return null;
    }
    const sessionHeader = request.headers["x-session-id"];
    const sessionId =
      (Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader) ?? randomUUID();
    const defaultAgentId = agents.list()[0]?.id;
    if (!body.model && !defaultAgentId) {
      void reply
        .code(400)
        .send({ error: { message: "No model specified and no agents registered" } });
      return null;
    }
    return {
      sessionId,
      model: body.model ?? defaultAgentId!,
      stream: Boolean(body.stream),
      includeUsage: Boolean(body.stream_options?.include_usage),
      input: {
        sessionId,
        messages: body.messages,
        userMessage: lastUser.content,
        allowedToolNames: request.allowedToolNames,
        temperature: body.temperature,
        maxTokens: body.max_tokens,
        signal,
      },
    };
  }
}

async function streamChatCompletion(
  agent: RegisteredAgent,
  resolved: ResolvedChatRequest,
  reply: FastifyReply,
  logger: Logger,
): Promise<void> {
  const streamId = `chatcmpl-${randomUUID()}`;
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-session-id": resolved.sessionId,
  });

  const write = (payload: unknown): void => {
    if (!reply.raw.writableEnded && !reply.raw.destroyed) {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  // First delta carries the assistant role per the OpenAI streaming contract.
  write(createCompletionChunk(streamId, { role: "assistant", content: "" }, null, resolved.model));

  try {
    for await (const event of agent.run.stream(resolved.input)) {
      if (reply.raw.destroyed) break;
      if (event.type === "delta") {
        if (!event.text) continue;
        write(createCompletionChunk(streamId, { content: event.text }, null, resolved.model));
      } else if (event.type === "done") {
        write(createCompletionChunk(streamId, {}, "stop", resolved.model));
        if (resolved.includeUsage && event.usage) {
          write(createUsageChunk(streamId, event.model ?? resolved.model, event.usage));
        }
      }
    }
    if (!reply.raw.writableEnded && !reply.raw.destroyed) {
      reply.raw.write("data: [DONE]\n\n");
    }
  } catch (error) {
    logger.error(
      { err: error },
      `Stream error for session=${resolved.sessionId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    write({
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: "STREAM_ERROR",
      },
    });
  } finally {
    reply.raw.end();
  }
}
