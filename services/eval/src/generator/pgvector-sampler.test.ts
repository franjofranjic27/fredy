import { describe, expect, it, vi } from "vitest";
import { PgVectorSampler } from "./pgvector-sampler.js";
import { SeededRng } from "./rng.js";

interface ChunkRow {
  chunk_id: string;
  page_id: string;
  space_key: string | null;
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
}

interface QueryResult {
  rows: ChunkRow[];
}

function makeRow(pageId: string, idx: number, spaceKey = "DOCS"): ChunkRow {
  return {
    chunk_id: `${pageId}_${idx}`,
    page_id: pageId,
    space_key: spaceKey,
    title: `Page ${pageId}`,
    content: `content ${pageId}/${idx}`,
    metadata: {
      spaceName: "Docs",
      headerPath: ["Section"],
      chunkIndex: idx,
      totalChunks: 3,
    },
  };
}

interface MockedSampler {
  sampler: PgVectorSampler;
  poolQuery: ReturnType<typeof vi.fn>;
  clientQuery: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

/**
 * Wires a PgVectorSampler to a mocked pg.Pool. `dataRows` is what the data
 * SELECT resolves to; the preceding `setseed` call resolves to an empty result.
 */
function makeSampler(dataRows: ChunkRow[]): MockedSampler {
  const clientQuery = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] }) // setseed
    .mockResolvedValue({ rows: dataRows } as QueryResult);
  const release = vi.fn();
  const poolQuery = vi.fn().mockResolvedValue({ rows: dataRows } as QueryResult);

  const sampler = new PgVectorSampler({
    databaseUrl: "postgresql://localhost/test",
    tableName: "chunks",
  });
  (sampler as unknown as { pool: unknown }).pool = {
    connect: vi.fn(async () => ({ query: clientQuery, release })),
    query: poolQuery,
    end: vi.fn(),
  };

  return { sampler, poolQuery, clientQuery, release };
}

describe("PgVectorSampler.sampleChunks", () => {
  it("maps rows into sampled chunks and respects the requested size", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => makeRow(`p${i}`, 0));
    const { sampler } = makeSampler(rows);

    const sample = await sampler.sampleChunks(4, new SeededRng(1));

    expect(sample).toHaveLength(4);
    expect(sample.map((c) => c.chunkId).sort()).toEqual(["p0_0", "p1_0", "p2_0", "p3_0"]);
    expect(sample[0].metadata.headerPath).toEqual(["Section"]);
  });

  it("seeds Postgres from the rng for reproducible DB-side sampling", async () => {
    const { sampler, clientQuery } = makeSampler([makeRow("p1", 0)]);

    await sampler.sampleChunks(1, new SeededRng(42));

    const setseedCall = clientQuery.mock.calls[0];
    expect(setseedCall[0]).toBe("SELECT setseed($1)");
    const seed = (setseedCall[1] as number[])[0];
    expect(seed).toBeGreaterThanOrEqual(-1);
    expect(seed).toBeLessThanOrEqual(1);
  });

  it("filters out rows with invalid metadata silently", async () => {
    const rows: ChunkRow[] = [
      makeRow("p1", 0),
      { ...makeRow("p2", 0), metadata: { missing: true } },
      makeRow("p3", 0),
    ];
    const { sampler } = makeSampler(rows);

    const sample = await sampler.sampleChunks(10, new SeededRng(1));

    expect(sample.map((c) => c.pageId).sort()).toEqual(["p1", "p3"]);
  });

  it("applies a spaceKey filter when provided", async () => {
    const { sampler, clientQuery } = makeSampler([]);

    await sampler.sampleChunks(5, new SeededRng(1), { spaceKey: "OPS" });

    const [sql, params] = clientQuery.mock.calls[1];
    expect(sql).toContain("WHERE space_key = $1");
    expect(params).toEqual(["OPS", 5]);
  });

  it("releases the pooled client", async () => {
    const { sampler, release } = makeSampler([makeRow("p1", 0)]);

    await sampler.sampleChunks(1, new SeededRng(1));

    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("PgVectorSampler.getChunksByPageId", () => {
  it("returns chunks of a page sorted by chunkIndex", async () => {
    const { sampler } = makeSampler([makeRow("p1", 2), makeRow("p1", 0), makeRow("p1", 1)]);

    const chunks = await sampler.getChunksByPageId("p1");

    expect(chunks.map((c) => c.metadata.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("applies a pageId filter", async () => {
    const { sampler, poolQuery } = makeSampler([]);

    await sampler.getChunksByPageId("p42");

    const [sql, params] = poolQuery.mock.calls[0];
    expect(sql).toContain("WHERE page_id = $1");
    expect(params).toEqual(["p42"]);
  });
});
