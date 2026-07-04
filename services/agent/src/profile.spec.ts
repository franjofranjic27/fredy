import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { resolveRagProfile } from "./profile.js";
import { createTestLogger } from "./testing/test-logger.js";

const baseEnv = {
  AGENT_ALLOW_ANONYMOUS: "true",
  EMBEDDING_PROVIDER: "openai",
  EMBEDDING_API_KEY: "shared-key",
  CHUNKS_TABLE: "chunks",
};

function poolReturning(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("resolveRagProfile", () => {
  it("uses env config when no RAG_PROFILE is set", async () => {
    const config = loadConfig(baseEnv);
    const pool = poolReturning([]);
    const profile = await resolveRagProfile(pool, config, createTestLogger().logger);
    expect(profile).toEqual({
      tableName: "chunks",
      embeddingProvider: "openai",
      embedding: config.embedding.openai,
      source: "env",
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("resolves table and embedding settings from the rag_profiles row", async () => {
    const config = loadConfig({ ...baseEnv, RAG_PROFILE: "confluence_v2" });
    const pool = poolReturning([
      {
        table_name: "chunks_confluence_v2",
        embedding_provider: "voyage",
        embedding_model: "voyage-3-large",
      },
    ]);
    const profile = await resolveRagProfile(pool, config, createTestLogger().logger);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM rag_profiles WHERE profile_name = $1"),
      ["confluence_v2"],
    );
    expect(profile.source).toBe("profile");
    expect(profile.tableName).toBe("chunks_confluence_v2");
    expect(profile.embeddingProvider).toBe("voyage");
    expect(profile.embedding.model).toBe("voyage-3-large");
    expect(profile.embedding.apiKey).toBe("shared-key"); // key still comes from env
  });

  it("falls back to env config with a warning when the profile row is missing", async () => {
    const config = loadConfig({ ...baseEnv, RAG_PROFILE: "missing" });
    const pool = poolReturning([]);
    const log = createTestLogger();
    const profile = await resolveRagProfile(pool, config, log.logger);
    expect(profile.source).toBe("env");
    expect(profile.tableName).toBe("chunks");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('"missing" not found'));
  });

  it("falls back to env config when the rag_profiles table does not exist (42P01)", async () => {
    const config = loadConfig({ ...baseEnv, RAG_PROFILE: "p" });
    const error = Object.assign(new Error('relation "rag_profiles" does not exist'), {
      code: "42P01",
    });
    const pool = { query: vi.fn().mockRejectedValue(error) };
    const log = createTestLogger();
    const profile = await resolveRagProfile(pool, config, log.logger);
    expect(profile.source).toBe("env");
    expect(log.warn).toHaveBeenCalled();
  });

  it("propagates other database errors", async () => {
    const config = loadConfig({ ...baseEnv, RAG_PROFILE: "p" });
    const pool = { query: vi.fn().mockRejectedValue(new Error("connection refused")) };
    await expect(resolveRagProfile(pool, config, createTestLogger().logger)).rejects.toThrow(
      "connection refused",
    );
  });

  it("rejects profile tables with invalid identifiers", async () => {
    const config = loadConfig({ ...baseEnv, RAG_PROFILE: "p" });
    const pool = poolReturning([
      { table_name: "bad;table", embedding_provider: "openai", embedding_model: "m" },
    ]);
    await expect(resolveRagProfile(pool, config, createTestLogger().logger)).rejects.toThrow(
      /Invalid table identifier/,
    );
  });

  it("rejects unsupported embedding providers from the profile", async () => {
    const config = loadConfig({ ...baseEnv, RAG_PROFILE: "p" });
    const pool = poolReturning([
      { table_name: "chunks", embedding_provider: "cohere", embedding_model: "m" },
    ]);
    await expect(resolveRagProfile(pool, config, createTestLogger().logger)).rejects.toThrow(
      /unsupported embedding provider "cohere"/,
    );
  });
});
