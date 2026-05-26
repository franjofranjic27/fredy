import { buildLoggerOptions } from "./logger.factory";

describe("buildLoggerOptions", () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.LOG_LEVEL = originalLogLevel;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("defaults to level 'info' when LOG_LEVEL unset", () => {
    delete process.env.LOG_LEVEL;
    const opts = buildLoggerOptions();
    expect(opts.level).toBe("info");
  });

  it("honours LOG_LEVEL env", () => {
    process.env.LOG_LEVEL = "debug";
    const opts = buildLoggerOptions();
    expect(opts.level).toBe("debug");
  });

  it("uses JSON format in production", () => {
    process.env.NODE_ENV = "production";
    const opts = buildLoggerOptions();
    expect(opts.format).toBeDefined();
    expect(opts.transports).toBeDefined();
  });

  it("uses pretty format when NODE_ENV is not production", () => {
    process.env.NODE_ENV = "development";
    const opts = buildLoggerOptions();
    expect(opts.format).toBeDefined();
  });
});
