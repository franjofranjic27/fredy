import { describe, expect, it } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolRegistry } from "./tool-registry.js";

function makeTool(name: string) {
  return tool(async () => "ok", {
    name,
    description: `${name} description`,
    schema: z.object({}),
  });
}

describe("ToolRegistry", () => {
  it("registers and retrieves tools by name", () => {
    const registry = new ToolRegistry();
    const search = makeTool("vector_search");
    registry.register(search);
    expect(registry.get("vector_search")).toBe(search);
    expect(registry.has("vector_search")).toBe(true);
    expect(registry.has("missing")).toBe(false);
    expect(registry.get("missing")).toBeUndefined();
  });

  it("lists tools and names in registration order", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("a"));
    registry.register(makeTool("b"));
    expect(registry.listNames()).toEqual(["a", "b"]);
    expect(registry.list().map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("rejects duplicate registration", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("a"));
    expect(() => registry.register(makeTool("a"))).toThrow('Tool "a" is already registered');
  });
});
