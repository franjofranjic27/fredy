import { hostname } from "node:os";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { buildLoggerOptions, createLogger } from "./logger.js";

/** Captures the JSON records a logger emits (production options → no transport). */
function captureLogs() {
  const records: Array<Record<string, unknown>> = [];
  const stream = { write: (line: string) => records.push(JSON.parse(line)) };
  const logger = pino(
    buildLoggerOptions({ serviceName: "svc" }, { NODE_ENV: "production" }),
    stream,
  );
  return { logger, records };
}

describe("buildLoggerOptions", () => {
  it("defaults the level to info", () => {
    const options = buildLoggerOptions({ serviceName: "svc" }, {});
    expect(options.level).toBe("info");
  });

  it("prefers the explicit level over LOG_LEVEL", () => {
    const options = buildLoggerOptions(
      { serviceName: "svc", level: "debug" },
      { LOG_LEVEL: "warn" },
    );
    expect(options.level).toBe("debug");
  });

  it("falls back to LOG_LEVEL when no explicit level is given", () => {
    const options = buildLoggerOptions({ serviceName: "svc" }, { LOG_LEVEL: "error" });
    expect(options.level).toBe("error");
  });

  it("binds service and env with SERVICE_NAME/PROJECT_ENV overrides", () => {
    const options = buildLoggerOptions(
      { serviceName: "svc" },
      { SERVICE_NAME: "renamed", PROJECT_ENV: "staging" },
    );
    expect(options.base).toEqual({ service: "renamed", env: "staging", host: hostname() });
  });

  it("defaults service to the given name and env to development", () => {
    const options = buildLoggerOptions({ serviceName: "svc" }, {});
    expect(options.base).toEqual({ service: "svc", env: "development", host: hostname() });
  });

  it("uses JSON output (no transport) in production", () => {
    const options = buildLoggerOptions({ serviceName: "svc" }, { NODE_ENV: "production" });
    expect(options.transport).toBeUndefined();
  });

  it("uses pino-pretty outside production", () => {
    const options = buildLoggerOptions({ serviceName: "svc" }, { NODE_ENV: "test" });
    expect(options.transport).toMatchObject({ target: "pino-pretty" });
  });
});

describe("createLogger", () => {
  it("creates a pino logger with the resolved level", () => {
    const logger = createLogger({ serviceName: "svc", level: "warn" }, { NODE_ENV: "production" });
    expect(logger.level).toBe("warn");
  });
});

describe("secret redaction", () => {
  it("redacts apiKey, nested apiKey and authorization headers", () => {
    const { logger, records } = captureLogs();
    logger.info(
      { apiKey: "top-secret", nested: { apiKey: "nested-secret" }, authorization: "Bearer t" },
      "with secrets",
    );
    logger.info({ req: { headers: { authorization: "Bearer t2" } } }, "request");

    const [first, second] = records;
    expect(first.apiKey).toBe("[REDACTED]");
    expect((first.nested as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect(first.authorization).toBe("[REDACTED]");
    const reqHeaders = (second.req as { headers: Record<string, unknown> }).headers;
    expect(reqHeaders.authorization).toBe("[REDACTED]");
  });
});
