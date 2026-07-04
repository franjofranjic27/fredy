import { describe, expect, it, vi } from "vitest";
import { createKnowledgeBaseStatsTool } from "./knowledge-base-stats.js";
import type { PgVectorStore } from "./pgvector.js";

describe("get_knowledge_base_stats tool", () => {
  it("reports the chunk count with the collection name", async () => {
    const store = {
      collectionName: "chunks",
      count: vi.fn().mockResolvedValue(1234),
    } as unknown as PgVectorStore;
    const tool = createKnowledgeBaseStatsTool(store);
    const output = await tool.invoke({});
    expect(output).toBe('The knowledge base "chunks" currently contains 1234 indexed chunks.');
  });

  it("rejects unexpected input keys (strict schema)", async () => {
    const store = {
      collectionName: "chunks",
      count: vi.fn().mockResolvedValue(0),
    } as unknown as PgVectorStore;
    const tool = createKnowledgeBaseStatsTool(store);
    await expect(tool.invoke({ nope: true } as never)).rejects.toThrow();
  });
});
