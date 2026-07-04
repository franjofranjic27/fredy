import { describe, expect, it } from "vitest";
import type { Classification } from "../classification.js";
import { initialTicketState, type TicketState } from "../state.js";
import { applyOverrides } from "./classify.js";

function state(overrides: Partial<TicketState> = {}): TicketState {
  return { ...initialTicketState("IT-1", "r1", "assigned"), ...overrides };
}

function parsed(overrides: Partial<Classification> = {}): Classification {
  return { path: "answer", confidence: 0.9, reasoning: "r", language: "de", ...overrides };
}

describe("classification overrides", () => {
  it("keeps a valid classification untouched", () => {
    const classification = parsed();
    expect(applyOverrides(classification, state())).toBe(classification);
  });

  it("coerces use_cache without hits to need_context on the first round", () => {
    const result = applyOverrides(parsed({ path: "use_cache" }), state({ cacheHits: [] }));
    expect(result.path).toBe("need_context");
  });

  it("coerces use_cache without hits to answer after the retrieval round", () => {
    const result = applyOverrides(
      parsed({ path: "use_cache" }),
      state({ cacheHits: [], retrievalRounds: 1 }),
    );
    expect(result.path).toBe("answer");
  });

  it("allows use_cache when a hit exists", () => {
    const hit = { ticketKey: "IT-9", question: "q", resolution: "r", score: 0.85, strong: false };
    const result = applyOverrides(parsed({ path: "use_cache" }), state({ cacheHits: [hit] }));
    expect(result.path).toBe("use_cache");
  });

  it("forces need_context to answer once the retrieval budget is spent", () => {
    const result = applyOverrides(parsed({ path: "need_context" }), state({ retrievalRounds: 1 }));
    expect(result.path).toBe("answer");
  });

  it("escalates below the confidence floor regardless of path", () => {
    const result = applyOverrides(parsed({ path: "answer", confidence: 0.3 }), state());
    expect(result.path).toBe("escalate");
  });
});
