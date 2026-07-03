import { ConfigService } from "@nestjs/config";
import { EmbeddingClient } from "../../shared/embedding/embedding-client.interface";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { VectorSearchTool } from "./vector-search.tool";
import { VectorStore } from "./vector-store.interface";

const ctx = { requestId: "r1" };

function createConfig(values: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function createEmbedding(vector: number[]): EmbeddingClient {
  return {
    providerId: "openai",
    model: "text-embedding-3-small",
    embedQuery: jest.fn().mockResolvedValue(vector),
  };
}

function createStore(
  hits: Array<{
    id: string;
    score: number;
    payload: { title: string; content: string; url: string; spaceKey: string };
  }>,
): VectorStore {
  return {
    providerId: "pgvector",
    collectionName: "chunks",
    search: jest.fn().mockResolvedValue(hits),
    count: jest.fn().mockResolvedValue(hits.length),
  };
}

describe("VectorSearchTool", () => {
  it("self-registers with the ToolRegistryService onModuleInit", () => {
    const registry = new ToolRegistryService();
    const tool = new VectorSearchTool(
      createEmbedding([0.1]),
      createStore([]),
      registry,
      createConfig({}),
    );
    tool.onModuleInit();
    expect(registry.hasTool("vector_search")).toBe(true);
    expect(registry.getTool("vector_search")).toBe(tool);
  });

  it("exposes db.system and db.collection as staticAttributes", () => {
    const tool = new VectorSearchTool(
      createEmbedding([0.1]),
      createStore([]),
      new ToolRegistryService(),
      createConfig({}),
    );
    expect(tool.staticAttributes).toMatchObject({
      "db.system": "pgvector",
      "db.collection.name": "chunks",
    });
  });

  it("embeds the query, calls the store and formats hits into the output", async () => {
    const registry = new ToolRegistryService();
    const embedding = createEmbedding([0.1, 0.2, 0.3]);
    const hits = [
      {
        id: "1",
        score: 0.92,
        payload: {
          title: "VPN Setup",
          content: "Connect via Cisco AnyConnect",
          url: "https://wiki/vpn",
          spaceKey: "IT",
        },
      },
    ];
    const store = createStore(hits);
    const tool = new VectorSearchTool(
      embedding,
      store,
      registry,
      createConfig({ "retrieval.defaultLimit": 5, "retrieval.scoreThreshold": 0.7 }),
    );

    const result = await tool.execute({ query: "how do I VPN?", spaceKey: "IT" }, ctx);

    expect(embedding.embedQuery).toHaveBeenCalledWith("how do I VPN?");
    expect(store.search).toHaveBeenCalledWith([0.1, 0.2, 0.3], {
      limit: 5,
      scoreThreshold: 0.7,
      filter: { spaceKey: "IT" },
    });
    expect(result.output).toContain("VPN Setup");
    expect(result.output).toContain("Cisco AnyConnect");
    expect(result.output).toContain("https://wiki/vpn");
    expect(result.metadata?.chunks).toEqual([
      {
        id: "1",
        score: 0.92,
        url: "https://wiki/vpn",
        title: "VPN Setup",
        spaceKey: "IT",
      },
    ]);
  });

  it("propagates embedding errors so the executor maps them", async () => {
    const registry = new ToolRegistryService();
    const embedding: EmbeddingClient = {
      providerId: "openai",
      model: "x",
      embedQuery: jest.fn().mockRejectedValue(new Error("embedding boom")),
    };
    const store = createStore([]);
    const tool = new VectorSearchTool(embedding, store, registry, createConfig({}));

    await expect(tool.execute({ query: "x" }, ctx)).rejects.toThrow("embedding boom");
  });

  it("uses input.limit when provided, defaultLimit otherwise", async () => {
    const registry = new ToolRegistryService();
    const store = createStore([]);
    const tool = new VectorSearchTool(
      createEmbedding([0]),
      store,
      registry,
      createConfig({ "retrieval.defaultLimit": 10 }),
    );

    await tool.execute({ query: "x", limit: 3 }, ctx);
    expect(store.search).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ limit: 3 }),
    );

    await tool.execute({ query: "y" }, ctx);
    expect(store.search).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ limit: 10 }),
    );
  });
});
