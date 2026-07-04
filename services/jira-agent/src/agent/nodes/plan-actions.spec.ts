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

  it("skips the cache write below the confidence floor", () => {
    const result = makePlanActionsNode(deps)(
      answeredState({
        classification: { path: "answer", confidence: 0.5, reasoning: "r", language: "de" },
      }),
    );
    expect(result.cacheWrite).toBeUndefined();
  });
});
