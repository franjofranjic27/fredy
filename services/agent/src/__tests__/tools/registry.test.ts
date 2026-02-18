import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../tools/registry.js";

describe("ToolRegistry", () => {
  it("registers and lists tools", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test-tool",
      description: "A test tool",
      inputSchema: z.object({ value: z.string() }),
      execute: async ({ value }) => `echo: ${value}`,
    });
    expect(registry.list()).toEqual(["test-tool"]);
  });

  it("executes a registered tool", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "add",
      description: "Adds two numbers",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    });
    const result = await registry.execute("add", { a: 2, b: 3 });
    expect(result).toBe(5);
  });

  it("throws for unknown tool", async () => {
    const registry = new ToolRegistry();
    await expect(registry.execute("unknown", {})).rejects.toThrow("Tool not found: unknown");
  });

  it("returns tool definitions", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "greet",
      description: "Greets the user",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    });
    const defs = registry.toDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe("greet");
    expect(defs[0].description).toBe("Greets the user");
  });

  it("toDefinitions returns valid JSON schema", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "calc",
      description: "Calculator",
      inputSchema: z.object({ x: z.number() }),
      execute: async ({ x }) => x * 2,
    });
    const [def] = registry.toDefinitions();
    expect(def.inputSchema).toBeDefined();
    expect(typeof def.inputSchema).toBe("object");
  });
});
