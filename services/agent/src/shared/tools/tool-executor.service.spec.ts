import { z } from "zod";
import { ObservabilityService } from "../observability/observability.service";
import { ToolExecutorService } from "./tool-executor.service";
import { ToolRegistryService } from "./tool-registry.service";
import { ToolDefinition, ToolError } from "./tool.interface";

function createObservability(): ObservabilityService {
  return { log: jest.fn() } as unknown as ObservabilityService;
}

function buildExecutor(registry: ToolRegistryService): ToolExecutorService {
  return new ToolExecutorService(registry, createObservability());
}

function makeEchoTool(): ToolDefinition<{ msg: string }, { echoed: string }> {
  return {
    name: "echo",
    description: "Echo a message",
    inputSchema: z.object({ msg: z.string().min(1) }),
    async execute(input) {
      return { output: input.msg, data: { echoed: input.msg } };
    },
  };
}

describe("ToolExecutorService", () => {
  let registry: ToolRegistryService;
  let executor: ToolExecutorService;

  beforeEach(() => {
    registry = new ToolRegistryService();
    executor = buildExecutor(registry);
  });

  it("returns not_found when the tool is unknown", async () => {
    const outcome = await executor.run("missing", {}, { requestId: "r1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("not_found");
      expect(outcome.error.retryable).toBe(false);
    }
  });

  it("returns schema_invalid with Zod issue details on bad input", async () => {
    registry.register(makeEchoTool());
    const outcome = await executor.run("echo", { msg: 123 }, { requestId: "r1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("schema_invalid");
      expect(outcome.error.message).toContain("msg");
      expect(outcome.error.retryable).toBe(false);
    }
  });

  it("runs the tool with validated input and returns the result on success", async () => {
    registry.register(makeEchoTool());
    const outcome = await executor.run<{ echoed: string }>(
      "echo",
      { msg: "hi" },
      { requestId: "r1", agentId: "a1" },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.output).toBe("hi");
      expect(outcome.result.data).toEqual({ echoed: "hi" });
    }
  });

  it("maps a thrown ToolError straight through", async () => {
    registry.register({
      name: "boom",
      description: "x",
      inputSchema: z.object({}),
      async execute() {
        throw new ToolError({
          code: "upstream_error",
          message: "502 from upstream",
          retryable: true,
        });
      },
    });
    const outcome = await executor.run("boom", {}, { requestId: "r1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("upstream_error");
      expect(outcome.error.retryable).toBe(true);
    }
  });

  it("wraps unknown thrown exceptions as internal errors", async () => {
    registry.register({
      name: "crash",
      description: "x",
      inputSchema: z.object({}),
      async execute() {
        throw new Error("oops");
      },
    });
    const outcome = await executor.run("crash", {}, { requestId: "r1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("internal");
      expect(outcome.error.message).toContain("oops");
    }
  });

  it("returns timeout when the tool exceeds the configured limit", async () => {
    registry.register({
      name: "slow",
      description: "x",
      inputSchema: z.object({}),
      async execute() {
        await new Promise((r) => setTimeout(r, 50));
        return { output: "" };
      },
    });
    const outcome = await executor.run("slow", {}, { requestId: "r1" }, { timeoutMs: 10 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("timeout");
      expect(outcome.error.retryable).toBe(true);
    }
  });

  it("passes ToolContext through to the tool", async () => {
    const seen: Array<unknown> = [];
    registry.register({
      name: "ctx",
      description: "x",
      inputSchema: z.object({}),
      async execute(_input, ctx) {
        seen.push(ctx);
        return { output: "" };
      },
    });
    await executor.run("ctx", {}, { requestId: "rX", sessionId: "sY", agentId: "agZ" });
    expect(seen[0]).toMatchObject({
      requestId: "rX",
      sessionId: "sY",
      agentId: "agZ",
    });
  });
});
