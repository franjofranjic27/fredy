import { describe, it, expect } from "vitest";
import { z } from "zod";
import { runAgent } from "../agent.js";
import { ToolRegistry } from "../tools/registry.js";
import { createMockLLMClient } from "./helpers/mock-llm.js";
import type { LLMResponse } from "../llm/types.js";

function makeConfig(responses: LLMResponse[], tools = new ToolRegistry()) {
  return {
    llm: createMockLLMClient(responses),
    tools,
    systemPrompt: "You are a test agent.",
    maxIterations: 5,
    verbose: false,
  };
}

describe("runAgent", () => {
  it("returns response with no tool calls", async () => {
    const config = makeConfig([
      {
        content: "Hello!",
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);
    const result = await runAgent(config, [{ role: "user", content: "Hi" }]);
    expect(result.response).toBe("Hello!");
    expect(result.toolsUsed).toHaveLength(0);
    expect(result.iterations).toBe(1);
  });

  it("executes tool call loop and returns final response", async () => {
    const registry = new ToolRegistry().register({
      name: "ping",
      description: "Pings a service",
      inputSchema: z.object({}),
      execute: async () => "pong",
    });

    const config = makeConfig(
      [
        {
          content: null,
          toolCalls: [{ id: "call-1", name: "ping", arguments: {} }],
          stopReason: "tool_use",
        },
        {
          content: "Done!",
          toolCalls: [],
          stopReason: "end_turn",
        },
      ],
      registry
    );

    const result = await runAgent(config, [{ role: "user", content: "Ping!" }]);
    expect(result.response).toBe("Done!");
    expect(result.toolsUsed).toHaveLength(1);
    expect(result.toolsUsed[0].name).toBe("ping");
    expect(result.toolsUsed[0].output).toBe("pong");
    expect(result.iterations).toBe(2);
  });

  it("throws on max iterations", async () => {
    const registry = new ToolRegistry().register({
      name: "loop",
      description: "Always triggers another iteration",
      inputSchema: z.object({}),
      execute: async () => "again",
    });

    const responses: LLMResponse[] = Array.from({ length: 10 }, (_, i) => ({
      content: null,
      toolCalls: [{ id: `call-${i}`, name: "loop", arguments: {} }],
      stopReason: "tool_use" as const,
    }));

    const config = { ...makeConfig(responses, registry), maxIterations: 2 };

    await expect(
      runAgent(config, [{ role: "user", content: "Go" }])
    ).rejects.toThrow(/max iterations/i);
  });
});
