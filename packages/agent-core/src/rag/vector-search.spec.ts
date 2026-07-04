import { describe, expect, it, vi } from "vitest";
import type { ToolMessage } from "@langchain/core/messages";
import { createVectorSearchTool, formatHits } from "./vector-search.js";
import type { EmbeddingClient } from "./embeddings.js";
import type { PgVectorStore, VectorSearchHit } from "./pgvector.js";

function hit(
  overrides: Partial<VectorSearchHit["payload"]> & { score?: number } = {},
): VectorSearchHit {
  const { score = 0.912, ...payload } = overrides;
  return {
    id: "1",
    score,
    payload: { content: "chunk content", ...payload },
  };
}

function makeTool(hits: VectorSearchHit[]) {
  const embedQuery = vi.fn().mockResolvedValue([0.1, 0.2]);
  const search = vi.fn().mockResolvedValue(hits);
  const embeddings = { provider: "openai", model: "m", embedQuery } as unknown as EmbeddingClient;
  const store = { search, collectionName: "chunks" } as unknown as PgVectorStore;
  const tool = createVectorSearchTool({
    embeddings,
    store,
    defaultLimit: 5,
    scoreThreshold: 0.7,
  });
  return { tool, embedQuery, search };
}

async function invoke(
  toolInstance: ReturnType<typeof makeTool>["tool"],
  args: Record<string, unknown>,
) {
  return (await toolInstance.invoke({
    type: "tool_call",
    id: "call-1",
    name: "vector_search",
    args,
  })) as ToolMessage;
}

describe("vector_search tool", () => {
  it("embeds the query and searches with the default limit and threshold", async () => {
    const { tool, embedQuery, search } = makeTool([hit({ title: "VPN", url: "https://wiki/vpn" })]);
    const message = await invoke(tool, { query: "vpn" });

    expect(embedQuery).toHaveBeenCalledWith("vpn");
    expect(search).toHaveBeenCalledWith([0.1, 0.2], {
      limit: 5,
      scoreThreshold: 0.7,
      spaceKey: undefined,
    });
    expect(message.content).toBe("### VPN (score=0.912)\nSource: https://wiki/vpn\nchunk content");
    expect((message.artifact as { hits: VectorSearchHit[] }).hits).toHaveLength(1);
  });

  it("respects an explicit limit and spaceKey", async () => {
    const { tool, search } = makeTool([]);
    await invoke(tool, { query: "vpn", limit: 2, spaceKey: "IT" });
    expect(search).toHaveBeenCalledWith([0.1, 0.2], {
      limit: 2,
      scoreThreshold: 0.7,
      spaceKey: "IT",
    });
  });

  it("returns the no-results sentinel for empty hits", async () => {
    const { tool } = makeTool([]);
    const message = await invoke(tool, { query: "vpn" });
    expect(message.content).toBe("No relevant documents found.");
  });

  it("rejects invalid input via the zod schema", async () => {
    const { tool } = makeTool([]);
    await expect(tool.invoke({ query: "" })).rejects.toThrow();
    await expect(tool.invoke({ query: "x", limit: 51 })).rejects.toThrow();
  });
});

describe("formatHits", () => {
  it("joins hits with the --- separator and falls back to Result n titles", () => {
    const hits: VectorSearchHit[] = [
      { id: "1", score: 0.9, payload: { content: "first" } },
      { id: "2", score: 0.812345, payload: { title: "Doc", content: "second", url: "https://u" } },
    ];
    expect(formatHits(hits)).toBe(
      "### Result 1 (score=0.900)\nfirst\n\n---\n\n### Doc (score=0.812)\nSource: https://u\nsecond",
    );
  });

  it("returns the sentinel for an empty list", () => {
    expect(formatHits([])).toBe("No relevant documents found.");
  });
});
