import { describe, expect, it } from "vitest";
import type { TriageGraphDeps } from "../deps.js";
import { initialTicketState, type TicketState } from "../state.js";
import { makePlanActionsNode } from "./plan-actions.js";

const deps = { projectKey: "OPS" } as unknown as TriageGraphDeps;

function answeredState(overrides: Partial<TicketState> = {}): TicketState {
  return {
    ...initialTicketState("IT-7", "r1", "assigned"),
    outcome: "answered",
    classification: { path: "answer", confidence: 0.9, reasoning: "r", language: "de" },
    cacheQuestion: "vpn setup question",
    cacheQueryEmbedding: [0.1, 0.2],
    draftComment: "answer text",
    context: "retrieved evidence",
    ...overrides,
  };
}

describe("plan_actions cache write", () => {
  it("uses the configured project key, never the issue-key prefix", () => {
    // Issue key prefix is IT — a write under IT would never be found by
    // cache_lookup, which filters on the configured project key.
    const result = makePlanActionsNode(deps)(answeredState());
    expect(result.cacheWrite?.projectKey).toBe("OPS");
  });

  it("skips the cache write when the answer had no retrieved or cached evidence", () => {
    // A confident-sounding "I could not find anything" must never become
    // cached evidence for future tickets.
    const result = makePlanActionsNode(deps)(answeredState({ context: null, cacheHits: [] }));
    expect(result.cacheWrite).toBeUndefined();
  });

  it("keeps the cache write when a cache hit was the evidence", () => {
    const hit = { ticketKey: "IT-9", question: "q", resolution: "r", score: 0.85, strong: false };
    const result = makePlanActionsNode(deps)(answeredState({ context: null, cacheHits: [hit] }));
    expect(result.cacheWrite).toBeDefined();
  });

  it("skips the cache write below the confidence floor", () => {
    const result = makePlanActionsNode(deps)(
      answeredState({
        classification: { path: "answer", confidence: 0.5, reasoning: "r", language: "de" },
      }),
    );
    expect(result.cacheWrite).toBeUndefined();
  });
});
