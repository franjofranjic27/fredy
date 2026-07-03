import { ConfigService } from "@nestjs/config";

const mockQuery = jest.fn();
const mockEnd = jest.fn();
jest.mock("pg", () => ({
  Pool: jest.fn(() => ({ query: mockQuery, end: mockEnd })),
}));

import { PgVectorService } from "./pgvector.service";

function createConfig(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("PgVectorService", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEnd.mockReset();
  });

  it("builds a cosine search query with score threshold and space filter", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          chunk_id: "1",
          title: "VPN",
          url: "https://x",
          space_key: "IT",
          content: "How to VPN",
          score: 0.91,
        },
      ],
    });
    const svc = new PgVectorService(
      createConfig({
        "database.url": "postgresql://fredy:fredy@localhost:5432/fredy",
        "database.table": "chunks",
      }),
    );

    const hits = await svc.search([0.1, 0.2], {
      limit: 5,
      scoreThreshold: 0.7,
      filter: { spaceKey: "IT" },
    });

    expect(hits).toEqual([
      {
        id: "1",
        score: 0.91,
        payload: { title: "VPN", content: "How to VPN", url: "https://x", spaceKey: "IT" },
      },
    ]);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("1 - (embedding <=> $1::vector) AS score");
    expect(sql).toContain("(1 - (embedding <=> $1::vector)) >= $2");
    expect(sql).toContain("space_key = $3");
    expect(sql).toContain("ORDER BY embedding <=> $1::vector ASC");
    expect(sql).toContain("FROM chunks");
    expect(params).toEqual(["[0.1,0.2]", 0.7, "IT", 5]);
  });

  it("omits WHERE clauses when neither threshold nor filter is given", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const svc = new PgVectorService(createConfig({}));

    const hits = await svc.search([0.5], { limit: 3 });

    expect(hits).toEqual([]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("WHERE");
    expect(params).toEqual(["[0.5]", 3]);
  });

  it("maps null payload columns to safe defaults", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ chunk_id: "2", title: null, url: null, space_key: null, content: "c", score: 0.5 }],
    });
    const svc = new PgVectorService(createConfig({}));

    const hits = await svc.search([0], { limit: 1 });

    expect(hits[0].payload).toEqual({
      title: undefined,
      content: "c",
      url: undefined,
      spaceKey: undefined,
    });
  });

  it("propagates query errors from search", async () => {
    mockQuery.mockRejectedValue(new Error("connection refused"));
    const svc = new PgVectorService(createConfig({}));

    await expect(svc.search([0], { limit: 1 })).rejects.toThrow("connection refused");
  });

  it("counts rows via count(*)", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: "42" }] });
    const svc = new PgVectorService(createConfig({}));

    await expect(svc.count()).resolves.toBe(42);
    expect(mockQuery.mock.calls[0][0]).toContain("count(*)");
  });

  it("returns 0 when the count query yields no rows", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const svc = new PgVectorService(createConfig({}));

    await expect(svc.count()).resolves.toBe(0);
  });

  it("exposes providerId and collectionName", () => {
    const svc = new PgVectorService(createConfig({ "database.table": "chunks" }));
    expect(svc.providerId).toBe("pgvector");
    expect(svc.collectionName).toBe("chunks");
  });

  it("rejects an invalid table identifier to guard against injection", () => {
    expect(
      () => new PgVectorService(createConfig({ "database.table": "chunks; DROP TABLE x" })),
    ).toThrow(/Invalid table identifier/);
  });

  it("closes the pool on module destroy", async () => {
    mockEnd.mockResolvedValue(undefined);
    const svc = new PgVectorService(createConfig({}));

    await svc.onModuleDestroy();

    expect(mockEnd).toHaveBeenCalledTimes(1);
  });
});
