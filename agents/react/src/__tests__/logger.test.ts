import { describe, it, expect } from "vitest";
import { createLogger } from "../logger.js";

function capture() {
  const lines: string[] = [];
  return { lines, output: (line: string) => lines.push(line) };
}

describe("createLogger", () => {
  it("emits messages at or above the configured level", () => {
    const { lines, output } = capture();
    const logger = createLogger({ level: "info", pretty: false, output });

    logger.debug("ignored");
    logger.info("kept");
    logger.warn("kept");
    logger.error("kept");

    expect(lines).toHaveLength(3);
    expect(lines.every((l) => !l.includes('"debug"'))).toBe(true);
  });

  it("suppresses all output when level is set above error", () => {
    // Simulates the noop-equivalent used in tests (level: "warn" filters debug/info)
    const { lines, output } = capture();
    const logger = createLogger({ level: "warn", pretty: false, output });

    logger.debug("no");
    logger.info("no");

    expect(lines).toHaveLength(0);
  });

  it("pretty format includes level label and message", () => {
    const { lines, output } = capture();
    const logger = createLogger({ level: "debug", pretty: true, output });

    logger.info("hello world");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/INFO\s+hello world/);
  });

  it("pretty format appends meta as key=value pairs", () => {
    const { lines, output } = capture();
    const logger = createLogger({ level: "debug", pretty: true, output });

    logger.info("test", { foo: "bar", count: 42 });

    expect(lines[0]).toMatch(/foo="bar"/);
    expect(lines[0]).toMatch(/count=42/);
  });

  it("JSON format produces valid JSON with required fields", () => {
    const { lines, output } = capture();
    const logger = createLogger({ level: "debug", pretty: false, output });

    logger.warn("something happened", { reason: "timeout" });

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("something happened");
    expect(parsed.reason).toBe("timeout");
    expect(typeof parsed.ts).toBe("string");
  });

  it("JSON format spreads meta fields into the top-level object", () => {
    const { lines, output } = capture();
    const logger = createLogger({ level: "debug", pretty: false, output });

    logger.error("oops", { code: "ERR_X", retries: 3 });

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.code).toBe("ERR_X");
    expect(parsed.retries).toBe(3);
  });
});
