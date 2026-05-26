import { SessionService } from "../../shared/memory/session/session.service";
import { ObservabilityService } from "../../shared/observability/observability.service";
import { ResponseRecorderService } from "./response-recorder.service";

function createObservability(): ObservabilityService {
  return {
    log: jest.fn(),
    startSpan: jest.fn(),
    endSpanOk: jest.fn(),
    endSpanError: jest.fn(),
  } as unknown as ObservabilityService;
}

function createSessions(): SessionService {
  return {
    appendMessages: jest.fn().mockResolvedValue(undefined),
  } as unknown as SessionService;
}

describe("ResponseRecorderService", () => {
  it("recordSuccess persists session and emits request + llm-call events", async () => {
    const observability = createObservability();
    const sessions = createSessions();
    const rec = new ResponseRecorderService(observability, sessions);
    await rec.recordSuccess(
      "s1",
      "r1",
      "claude-sonnet-4-5",
      "user q",
      "assistant resp",
      Date.now() - 50,
      { inputTokens: 100, outputTokens: 30 },
    );
    expect(sessions.appendMessages).toHaveBeenCalledWith(
      "s1",
      expect.arrayContaining([
        { role: "user", content: "user q" },
        { role: "assistant", content: "assistant resp" },
      ]),
    );
    const calls = (observability.log as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(calls).toContain("request");
    expect(calls).toContain("llm-call");
  });

  it("recordFallback persists session and tags request with finishReason=fallback", async () => {
    const observability = createObservability();
    const sessions = createSessions();
    const rec = new ResponseRecorderService(observability, sessions);
    await rec.recordFallback("s1", "r1", "model", "user q", "no answer", Date.now());
    expect(sessions.appendMessages).toHaveBeenCalled();
    expect(observability.log).toHaveBeenCalledWith(
      expect.objectContaining({ type: "request", finishReason: "fallback" }),
    );
  });

  it("recordError persists partial response and tags request with finishReason=error", async () => {
    const observability = createObservability();
    const sessions = createSessions();
    const rec = new ResponseRecorderService(observability, sessions);
    await rec.recordError(
      "s1",
      "r1",
      "model",
      "user q",
      "partial",
      Date.now() - 10,
      new Error("network down"),
    );
    expect(sessions.appendMessages).toHaveBeenCalled();
    expect(observability.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "request",
        finishReason: "error",
        error: "network down",
      }),
    );
  });

  it("recordError skips session write when partial response is empty", async () => {
    const observability = createObservability();
    const sessions = createSessions();
    const rec = new ResponseRecorderService(observability, sessions);
    await rec.recordError("s1", "r1", "m", "q", "", Date.now(), new Error("boom"));
    expect(sessions.appendMessages).not.toHaveBeenCalled();
  });
});
