import { Test, TestingModule } from "@nestjs/testing";
import { z } from "zod";
import { ToolDefinition, ToolResult } from "./tool.interface";
import { ToolRegistryService } from "./tool-registry.service";

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Test tool ${name}`,
    inputSchema: z.object({ query: z.string().optional() }),
    async execute(): Promise<ToolResult> {
      return { output: name };
    },
  };
}

describe("ToolRegistryService", () => {
  let registry: ToolRegistryService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ToolRegistryService],
    }).compile();
    registry = moduleRef.get(ToolRegistryService);
  });

  it("registers and retrieves a tool by name", () => {
    const tool = makeTool("vector_search");
    registry.register(tool);
    expect(registry.getTool("vector_search")).toBe(tool);
    expect(registry.hasTool("vector_search")).toBe(true);
  });

  it("returns undefined and false for missing tools", () => {
    expect(registry.getTool("missing")).toBeUndefined();
    expect(registry.hasTool("missing")).toBe(false);
  });

  it("rejects duplicate registrations", () => {
    registry.register(makeTool("vector_search"));
    expect(() => registry.register(makeTool("vector_search"))).toThrow(/already registered/);
  });

  it("exposes descriptions with JSON schema derived from Zod input schema", () => {
    registry.register(makeTool("a"));
    registry.register(makeTool("b"));
    expect(registry.listNames()).toEqual(["a", "b"]);
    const descriptions = registry.getDescriptions();
    expect(descriptions.map((d) => d.name)).toEqual(["a", "b"]);
    expect(descriptions[0].parametersJsonSchema).toMatchObject({
      type: "object",
      properties: { query: expect.any(Object) },
    });
  });

  it("getJsonSchema returns the JSON schema for a registered tool", () => {
    registry.register(makeTool("vector_search"));
    const schema = registry.getJsonSchema("vector_search");
    expect(schema).toMatchObject({ type: "object" });
  });

  it("getJsonSchema returns undefined for unknown tools", () => {
    expect(registry.getJsonSchema("missing")).toBeUndefined();
  });

  it("reports size", () => {
    expect(registry.size).toBe(0);
    registry.register(makeTool("x"));
    expect(registry.size).toBe(1);
  });
});
