// OTel must initialise before anything else so auto-instrumentation can patch
// HTTP clients used by Fastify, pg and the LLM SDKs.
import { initTracing } from "@fredy/agent-core";
const tracing = initTracing("fredy-jira-agent");

import pg from "pg";
import {
  createEmbeddingClient,
  createLogger,
  PgVectorStore,
  resolveChatModel,
} from "@fredy/agent-core";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { createJiraClient } from "./jira/jira-client.js";
import { TicketQueue } from "./queue.js";
import { JiraPoller } from "./poller.js";
import { createTicketProcessor } from "./processor.js";
import { TicketCacheStore } from "./cache/ticket-cache.js";
import { TicketHandlerRegistry } from "./handlers/handler.js";
import { createAccessRequestHandler } from "./handlers/access-request-handler.js";
import { AutoApproveGate } from "./actions/action-gate.js";
import { createActionExecutor } from "./actions/executor.js";
import { createTriageTicketAgent } from "./agent/ticket-processor.js";
import { defaultInvokeStructured, type CreateModelOptions } from "./agent/llm.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ serviceName: "fredy-jira-agent", level: config.logLevel });

  const pool = new pg.Pool({ connectionString: config.database.url });
  // pg emits 'error' on idle clients (e.g. backend termination); an unhandled
  // 'error' event would crash the process, so log it and let the pool recover.
  pool.on("error", (error) => {
    logger.error({ err: error }, `Idle pg client error: ${error.message}`);
  });

  try {
    const jiraClient = createJiraClient({
      baseUrl: config.jira.baseUrl,
      email: config.jira.email,
      apiToken: config.jira.apiToken,
    });

    const cache = new TicketCacheStore(pool, config.database.ticketCacheTable, logger);
    await cache.ensureSchema();
    const chunks = new PgVectorStore(pool, config.database.chunksTable, logger);
    const embeddings = createEmbeddingClient(
      config.embedding.provider,
      config.embedding[config.embedding.provider],
      fetch,
      config.embedding.timeoutMs,
    );
    const handlers = new TicketHandlerRegistry();
    handlers.register(createAccessRequestHandler());
    const createModel = (options?: CreateModelOptions) =>
      resolveChatModel(config.llm.fallbackModel, {
        fallbackModel: config.llm.fallbackModel,
        anthropic: config.llm.anthropic,
        openai: config.llm.openai,
        gemini: config.llm.gemini,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        logger,
      });

    const executor = createActionExecutor({
      client: jiraClient,
      gate: new AutoApproveGate(),
      cache,
      transitionNames: {
        resolve: config.jira.transitions.resolve,
        "waiting-for-reporter": config.jira.transitions.waitingForReporter,
      },
      logger,
    });
    const agent = createTriageTicketAgent({
      graphDeps: {
        client: jiraClient,
        embeddings,
        cache,
        chunks,
        handlers,
        createModel,
        invokeStructured: defaultInvokeStructured(createModel),
        projectKey: config.jira.projectKey,
        agentAccountId: config.jira.agentAccountId,
        retrieval: config.retrieval,
        logger,
      },
      executor,
    });

    const queue = new TicketQueue(logger);
    queue.start(
      createTicketProcessor({
        client: jiraClient,
        agent,
        agentAccountId: config.jira.agentAccountId,
        logger,
      }),
    );
    const poller = new JiraPoller({
      client: jiraClient,
      queue,
      logger,
      jql: config.jira.pollJql,
      intervalMs: config.jira.pollIntervalMs,
      projectKey: config.jira.projectKey,
    });

    const app = buildServer({
      config,
      logger,
      getPollerStatus: () => ({ ...poller.status, queueDepth: queue.depth }),
      enqueue: (event) => queue.enqueue(event),
    });

    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal} — shutting down`);
      poller.stop();
      await queue.stop();
      await app.close();
      await pool.end();
      await tracing.shutdown();
      process.exit(0);
    };
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));

    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info(
      `Fredy Jira Agent listening on http://0.0.0.0:${config.port} ` +
        `(project=${config.jira.projectKey}, pollIntervalMs=${config.jira.pollIntervalMs})`,
    );
    await poller.start();
  } catch (error) {
    // Release DB connections before the process exits on a failed boot.
    await pool.end().catch(() => undefined);
    throw error;
  }
}

bootstrap().catch((error) => {
  console.error("Bootstrap failed", error);
  process.exit(1);
});
