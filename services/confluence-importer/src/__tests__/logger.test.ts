import { describe, it, expect } from "vitest";
import { createLogger } from "../logger.js";

describe("createLogger", () => {
  it("outputs info messages by default", () => {
    const lines: string[] = [];
    const logger = createLogger({ output: (l) => lines.push(l) });
    logger.info("hello");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("INFO");
    expect(lines[0]).toContain("hello");
  });

  it("suppresses debug when level is info", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "info", output: (l) => lines.push(l) });
    logger.debug("hidden");
    expect(lines).toHaveLength(0);
  });

  it("emits debug when level is debug", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", output: (l) => lines.push(l) });
    logger.debug("visible");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("DEBUG");
  });

  it("only emits warn and error when level is warn", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", output: (l) => lines.push(l) });
    logger.debug("no");
    logger.info("no");
    logger.warn("yes");
    logger.error("yes");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("WARN");
    expect(lines[1]).toContain("ERROR");
  });

  it("only emits error when level is error", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "error", output: (l) => lines.push(l) });
    logger.warn("no");
    logger.error("yes");
    expect(lines).toHaveLength(1);
  });

  it("includes metadata as key=value in pretty mode", () => {
    const lines: string[] = [];
    const logger = createLogger({ pretty: true, output: (l) => lines.push(l) });
    logger.info("msg", { count: 42, name: "foo" });
    expect(lines[0]).toContain("count=42");
    expect(lines[0]).toContain('name="foo"');
  });

  it("outputs valid JSON in non-pretty mode", () => {
    const lines: string[] = [];
    const logger = createLogger({ pretty: false, output: (l) => lines.push(l) });
    logger.info("msg", { foo: "bar" });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("msg");
    expect(parsed.foo).toBe("bar");
    expect(parsed.ts).toBeDefined();
  });

  it("emits all four log levels correctly", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", output: (l) => lines.push(l) });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines).toHaveLength(4);
  });

  it("omits metadata section when no meta is passed", () => {
    const lines: string[] = [];
    const logger = createLogger({ pretty: true, output: (l) => lines.push(l) });
    logger.info("clean");
    // No trailing space before key=value pairs
    expect(lines[0].trimEnd()).toBe(lines[0].replace(/ $/, ""));
    expect(lines[0]).not.toContain("=");
  });
});
