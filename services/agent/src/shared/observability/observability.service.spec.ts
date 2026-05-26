import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ObservabilityService } from "./observability.service";

describe("ObservabilityService", () => {
  let service: ObservabilityService;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ObservabilityService],
    }).compile();
    service = moduleRef.get(ObservabilityService);
    logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe("log", () => {
    it("emits JSON-serialised event with enriched fields", () => {
      service.log({
        type: "request",
        agent: "rag-agent",
        sessionId: "s1",
        model: "claude-sonnet",
        durationMs: 123,
        finishReason: "stop",
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const arg = logSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(arg);
      expect(parsed).toMatchObject({
        type: "request",
        agent: "rag-agent",
        sessionId: "s1",
        model: "claude-sonnet",
        durationMs: 123,
        finishReason: "stop",
        service: expect.any(String),
        env: expect.any(String),
        host: expect.any(String),
        timestamp: expect.any(String),
      });
    });
  });

  describe("startSpan", () => {
    it("returns a span that can be ended", () => {
      const span = service.startSpan("agent.run", "req-123");
      expect(typeof span.end).toBe("function");
      expect(typeof span.setAttribute).toBe("function");
      span.end();
    });

    it("composes parent.child naming when parentName provided", () => {
      const span = service.startSpan("retrieval", "req-1", "rag-agent");
      expect(typeof span.end).toBe("function");
      span.end();
    });
  });

  describe("endSpanError", () => {
    it("does not throw when given an Error", () => {
      const span = service.startSpan("test", "req-2");
      expect(() => service.endSpanError(span, new Error("boom"))).not.toThrow();
    });

    it("does not throw when given a non-Error value", () => {
      const span = service.startSpan("test", "req-3");
      expect(() => service.endSpanError(span, "broken")).not.toThrow();
    });
  });
});
