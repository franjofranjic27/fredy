// OTel must initialise before anything else so auto-instrumentation can patch
// HTTP clients used by Fastify, pg and the LLM SDKs.
import { initTracing } from "@fredy/agent-core";
const tracing = initTracing("fredy-jira-agent");

import pg from "pg";
import { createLogger } from "@fredy/agent-core";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

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
    const app = buildServer({
      config,
      logger,
      getPollerStatus: () => ({ lastRunAt: null, lastError: null, queueDepth: 0 }),
    });

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
      `Fredy Jira Agent listening on http://0.0.0.0:${config.port} ` +
        `(project=${config.jira.projectKey}, pollIntervalMs=${config.jira.pollIntervalMs})`,
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
