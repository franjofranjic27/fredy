import { describe, expect, it } from "vitest";
import { makeIssue } from "../testing/fake-jira-client.js";
import type { TicketSnapshot } from "../jira/types.js";
import { TicketHandlerRegistry, type TicketHandler } from "./handler.js";

function snapshot(overrides: Parameters<typeof makeIssue>[0] = {}): TicketSnapshot {
  return { issue: makeIssue(overrides), comments: [] };
}

function handler(id: string, matches: boolean): TicketHandler {
  return {
    id,
    description: id,
    matches: () => matches,
    handle: async () => ({ comment: id, outcome: "resolved" }),
  };
}

describe("TicketHandlerRegistry", () => {
  it("throws on duplicate handler ids", () => {
    const registry = new TicketHandlerRegistry();
    registry.register(handler("a", true));
    expect(() => registry.register(handler("a", false))).toThrow(
      "Ticket handler already registered: a",
    );
  });

  it("returns the first matching handler in registration order", () => {
    const registry = new TicketHandlerRegistry();
    registry.register(handler("first", true));
    registry.register(handler("second", true));
    expect(registry.match(snapshot())?.id).toBe("first");
  });

  it("returns undefined when nothing matches", () => {
    const registry = new TicketHandlerRegistry();
    registry.register(handler("a", false));
    expect(registry.match(snapshot())).toBeUndefined();
  });

  it("lists registered handlers", () => {
    const registry = new TicketHandlerRegistry();
    registry.register(handler("a", false));
    registry.register(handler("b", true));
    expect(registry.list().map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});
