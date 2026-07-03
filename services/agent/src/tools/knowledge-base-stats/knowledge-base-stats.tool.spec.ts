import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { VectorStore } from "../vector-search/vector-store.interface";
import { KnowledgeBaseStatsTool } from "./knowledge-base-stats.tool";

const ctx = { requestId: "r1" };

function createStore(count: number, failing = false): VectorStore {
  return {
    providerId: "pgvector",
    collectionName: "chunks",
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

  it("exposes db.system and db.collection as staticAttributes", () => {
    const tool = new KnowledgeBaseStatsTool(createStore(0), new ToolRegistryService());
    expect(tool.staticAttributes).toMatchObject({
      "db.system": "pgvector",
      "db.collection.name": "chunks",
    });
  });

  it("returns formatted count", async () => {
    const registry = new ToolRegistryService();
    const tool = new KnowledgeBaseStatsTool(createStore(42), registry);
    const result = await tool.execute({}, ctx);
    expect(result.data).toEqual({ count: 42, collection: "chunks" });
    expect(result.output).toContain("42 indexed chunks");
  });

  it("propagates store errors", async () => {
    const registry = new ToolRegistryService();
    const tool = new KnowledgeBaseStatsTool(createStore(0, true), registry);
    await expect(tool.execute({}, ctx)).rejects.toThrow("connection refused");
  });
});
