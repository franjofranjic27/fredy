import { describe, expect, it } from "vitest";
import type { AgentDefinition, AgentRun } from "./agent.js";
import { AgentRegistry } from "./agent-registry.js";

function makeRun(): AgentRun {
  return {
    invoke: async () => ({ content: "ok", model: "m" }),
     
    stream: async function* () {
      yield "ok";
    },
  };
}

function makeDefinition(id: string, ownedBy?: string): AgentDefinition<{ marker: string }> {
  return {
    id,
    ownedBy,
    createRun: () => makeRun(),
  };
}

describe("AgentRegistry", () => {
  it("registers an agent and instantiates its run with deps", () => {
    const registry = new AgentRegistry();
    let receivedDeps: { marker: string } | undefined;
    const definition: AgentDefinition<{ marker: string }> = {
      id: "rag-agent",
      createRun: (deps) => {
        receivedDeps = deps;
        return makeRun();
      },
    };
    registry.register(definition, { marker: "deps" });
    expect(receivedDeps).toEqual({ marker: "deps" });
    expect(registry.get("rag-agent")?.id).toBe("rag-agent");
  });

  it("defaults ownedBy to fredy", () => {
    const registry = new AgentRegistry();
    registry.register(makeDefinition("a"), { marker: "" });
    registry.register(makeDefinition("b", "acme"), { marker: "" });
    expect(registry.get("a")?.ownedBy).toBe("fredy");
    expect(registry.get("b")?.ownedBy).toBe("acme");
  });

  it("lists agents and ids in registration order", () => {
    const registry = new AgentRegistry();
    registry.register(makeDefinition("first"), { marker: "" });
    registry.register(makeDefinition("second"), { marker: "" });
    expect(registry.listIds()).toEqual(["first", "second"]);
    expect(registry.list().map((agent) => agent.id)).toEqual(["first", "second"]);
  });

  it("rejects duplicate agent ids", () => {
    const registry = new AgentRegistry();
    registry.register(makeDefinition("dup"), { marker: "" });
    expect(() => registry.register(makeDefinition("dup"), { marker: "" })).toThrow(
      'Agent "dup" is already registered',
    );
  });
});
