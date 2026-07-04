// OTel must initialise before anything else so auto-instrumentation can patch
// HTTP clients used by Fastify, pg and the LLM SDKs.
import { initTracing } from "@fredy/agent-core";
const tracing = initTracing("fredy-agent");

import pg from "pg";
import { AgentRegistry, createLogger, ToolRegistry } from "@fredy/agent-core";
import { loadConfig } from "./config.js";
import { resolveRagProfile } from "./profile.js";
import { createReranker } from "./rerank/factory.js";
import { createRagAgent } from "./agents/rag-agent/rag-agent.js";
import { buildServer } from "./server.js";
import { createEmbeddingClient } from "./tools/embeddings.js";
import { PgVectorStore } from "./tools/pgvector.js";
import { createVectorSearchTool } from "./tools/vector-search.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ serviceName: "fredy-agent", level: config.logLevel });

  const pool = new pg.Pool({ connectionString: config.database.url });
  // pg emits 'error' on idle clients (e.g. backend termination); an unhandled
  // 'error' event would crash the process, so log it and let the pool recover.
  pool.on("error", (error) => {
    logger.error({ err: error }, `Idle pg client error: ${error.message}`);
  });

  try {
    const profile = await resolveRagProfile(pool, config, logger);
    const store = new PgVectorStore(pool, profile.tableName, logger);
    const embeddings = createEmbeddingClient(profile.embeddingProvider, profile.embedding);

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(
      createVectorSearchTool({
        embeddings,
        store,
        defaultLimit: config.retrieval.defaultLimit,
        scoreThreshold: config.retrieval.scoreThreshold,
      }),
    );

    const reranker = createReranker(config.rerank);

    const agentRegistry = new AgentRegistry();
    agentRegistry.register(createRagAgent(), {
      config,
      toolRegistry,
      reranker,
      logger,
    });

    const app = buildServer({ config, logger, agentRegistry, toolRegistry });

    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal} — shutting down`);
      await app.close();
      await pool.end();
      await tracing.shutdown();
      process.exit(0);
    };
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));

    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info(
      `Fredy Agent listening on http://0.0.0.0:${config.port} ` +
        `(profile=${profile.source}, table=${profile.tableName}, reranker=${config.rerank.provider})`,
    );
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
