import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { VectorStore } from "../vector-search/vector-store.interface";
import { KnowledgeBaseStatsTool } from "./knowledge-base-stats.tool";

function createStore(count: number, failing = false): VectorStore {
  return {
    providerId: "qdrant",
    collectionName: "confluence-pages",
    search: jest.fn(),
    count: failing
      ? jest.fn().mockRejectedValue(new Error("connection refused"))
      : jest.fn().mockResolvedValue(count),
  };
}

describe("KnowledgeBaseStatsTool", () => {
  it("self-registers on module init", () => {
    const registry = new ToolRegistryService();
    const tool = new KnowledgeBaseStatsTool(createStore(0), registry);
    tool.onModuleInit();
    expect(registry.hasTool("get_knowledge_base_stats")).toBe(true);
  });

  it("returns success with formatted count", async () => {
    const registry = new ToolRegistryService();
    const tool = new KnowledgeBaseStatsTool(createStore(42), registry);
    const result = await tool.execute();
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ count: 42, collection: "confluence-pages" });
    expect(result.output).toContain("42 indexed chunks");
  });

  it("returns success:false when the store throws", async () => {
    const registry = new ToolRegistryService();
    const tool = new KnowledgeBaseStatsTool(createStore(0, true), registry);
    const result = await tool.execute();
    expect(result.success).toBe(false);
    expect(result.output).toContain("connection refused");
  });
});
