import { hostname } from "node:os";
import pino from "pino";

export type Logger = pino.Logger;

export interface CreateLoggerOptions {
  /** Logical service name; overridable via the SERVICE_NAME env var. */
  readonly serviceName: string;
  /** Log level; defaults to LOG_LEVEL env var, then "info". */
  readonly level?: string;
}

/**
 * Builds the pino options shared by every Fredy service:
 * JSON logs in production, pretty-printed logs in development
 * (pino-pretty is a devDependency and only referenced outside production).
 */
export function buildLoggerOptions(
  options: CreateLoggerOptions,
  env: NodeJS.ProcessEnv = process.env,
): pino.LoggerOptions {
  const level = options.level ?? env.LOG_LEVEL ?? "info";
  const isProduction = env.NODE_ENV === "production";

  return {
    level,
    // Defence-in-depth: never let secrets reach the logs even if an object
    // carrying them is logged accidentally.
    redact: {
      paths: ["authorization", "req.headers.authorization", "*.apiKey", "apiKey"],
      censor: "[REDACTED]",
    },
    base: {
      service: env.SERVICE_NAME ?? options.serviceName,
      env: env.PROJECT_ENV ?? "development",
      host: hostname(),
    },
    transport: isProduction
      ? undefined
      : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
  };
}

export function createLogger(
  options: CreateLoggerOptions,
  env: NodeJS.ProcessEnv = process.env,
): Logger {
  return pino(buildLoggerOptions(options, env));
}
