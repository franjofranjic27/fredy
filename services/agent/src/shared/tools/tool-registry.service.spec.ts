import { Test, TestingModule } from "@nestjs/testing";
import { Tool, ToolResult } from "./tool.interface";
import { ToolRegistryService } from "./tool-registry.service";

function makeTool(name: string): Tool {
  return {
    description: {
      name,
      description: `Test tool ${name}`,
      parametersJsonSchema: { type: "object", properties: {} },
    },
    async execute(): Promise<ToolResult> {
      return { success: true, output: name };
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

  it("exposes descriptions and names in registration order", () => {
    registry.register(makeTool("a"));
    registry.register(makeTool("b"));
    expect(registry.listNames()).toEqual(["a", "b"]);
    expect(registry.getDescriptions().map((d) => d.name)).toEqual(["a", "b"]);
  });

  it("reports size", () => {
    expect(registry.size).toBe(0);
    registry.register(makeTool("x"));
    expect(registry.size).toBe(1);
  });
});
