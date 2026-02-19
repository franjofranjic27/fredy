import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../config.js";

// Env vars touched by loadConfig
const ENV_KEYS = [
  "EMBEDDING_PROVIDER",
  "EMBEDDING_API_KEY",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  "CONFLUENCE_BASE_URL",
  "CONFLUENCE_USERNAME",
  "CONFLUENCE_API_TOKEN",
  "CONFLUENCE_SPACES",
  "CONFLUENCE_INCLUDE_LABELS",
  "CONFLUENCE_EXCLUDE_LABELS",
  "QDRANT_URL",
  "QDRANT_COLLECTION",
  "QDRANT_API_KEY",
  "CHUNK_MAX_TOKENS",
  "CHUNK_OVERLAP_TOKENS",
  "CHUNK_PRESERVE_CODE",
  "CHUNK_PRESERVE_TABLES",
  "SYNC_CRON",
  "SYNC_FULL_ON_START",
  "LOCAL_FILES_ENABLED",
  "LOCAL_FILES_DIRECTORY",
  "LOCAL_FILES_EXTENSIONS",
  "LOG_LEVEL",
] as const;

type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string>>;

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
}

// Minimal valid env — only embedding is required
const BASE: Record<string, string> = {
  EMBEDDING_PROVIDER: "openai",
  EMBEDDING_API_KEY: "test-key",
  EMBEDDING_MODEL: "text-embedding-3-small",
};

describe("loadConfig", () => {
  let saved: EnvSnapshot;

  beforeEach(() => {
    saved = snapshotEnv();
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, BASE);
  });

  afterEach(() => restoreEnv(saved));

  it("loads minimal config without Confluence", () => {
    const config = loadConfig();
    expect(config.confluence).toBeUndefined();
    expect(config.embedding.provider).toBe("openai");
    expect(config.embedding.apiKey).toBe("test-key");
  });

  it("applies embedding defaults", () => {
    const config = loadConfig();
    expect(config.embedding.dimensions).toBe(1536);
  });

  it("overrides embedding dimensions via env var", () => {
    process.env.EMBEDDING_DIMENSIONS = "768";
    expect(loadConfig().embedding.dimensions).toBe(768);
  });

  it("applies qdrant defaults", () => {
    const config = loadConfig();
    expect(config.qdrant.url).toBe("http://localhost:6333");
    expect(config.qdrant.collectionName).toBe("confluence-pages");
    expect(config.qdrant.apiKey).toBeUndefined();
  });

  it("overrides qdrant settings via env vars", () => {
    process.env.QDRANT_URL = "http://qdrant:6333";
    process.env.QDRANT_COLLECTION = "my-collection";
    process.env.QDRANT_API_KEY = "qdrant-key";
    const config = loadConfig();
    expect(config.qdrant.url).toBe("http://qdrant:6333");
    expect(config.qdrant.collectionName).toBe("my-collection");
    expect(config.qdrant.apiKey).toBe("qdrant-key");
  });

  it("applies chunking defaults", () => {
    const config = loadConfig();
    expect(config.chunking.maxTokens).toBe(800);
    expect(config.chunking.overlapTokens).toBe(100);
    expect(config.chunking.preserveCodeBlocks).toBe(true);
    expect(config.chunking.preserveTables).toBe(true);
  });

  it("overrides chunking settings via env vars", () => {
    process.env.CHUNK_MAX_TOKENS = "400";
    process.env.CHUNK_OVERLAP_TOKENS = "50";
    process.env.CHUNK_PRESERVE_CODE = "false";
    const config = loadConfig();
    expect(config.chunking.maxTokens).toBe(400);
    expect(config.chunking.overlapTokens).toBe(50);
    expect(config.chunking.preserveCodeBlocks).toBe(false);
  });

  it("applies sync defaults", () => {
    const config = loadConfig();
    expect(config.sync.cronSchedule).toBe("0 */6 * * *");
    expect(config.sync.fullSyncOnStart).toBe(false);
  });

  it("enables fullSyncOnStart via env var", () => {
    process.env.SYNC_FULL_ON_START = "true";
    expect(loadConfig().sync.fullSyncOnStart).toBe(true);
  });

  it("applies local files defaults", () => {
    const config = loadConfig();
    expect(config.localFiles.enabled).toBe(false);
    expect(config.localFiles.directory).toBe("/data/files");
    expect(config.localFiles.extensions).toEqual([".md", ".txt", ".html"]);
  });

  it("enables local files and overrides settings via env vars", () => {
    process.env.LOCAL_FILES_ENABLED = "true";
    process.env.LOCAL_FILES_DIRECTORY = "/my/docs";
    process.env.LOCAL_FILES_EXTENSIONS = ".md,.rst";
    const config = loadConfig();
    expect(config.localFiles.enabled).toBe(true);
    expect(config.localFiles.directory).toBe("/my/docs");
    expect(config.localFiles.extensions).toEqual([".md", ".rst"]);
  });

  it("defaults log level to info", () => {
    expect(loadConfig().logLevel).toBe("info");
  });

  it("overrides log level via env var", () => {
    process.env.LOG_LEVEL = "debug";
    expect(loadConfig().logLevel).toBe("debug");
  });

  it("includes Confluence config when CONFLUENCE_BASE_URL is set", () => {
    process.env.CONFLUENCE_BASE_URL = "https://company.atlassian.net/wiki";
    process.env.CONFLUENCE_USERNAME = "user@example.com";
    process.env.CONFLUENCE_API_TOKEN = "token123";
    process.env.CONFLUENCE_SPACES = "IT,DOCS";
    const config = loadConfig();
    expect(config.confluence).toBeDefined();
    expect(config.confluence!.baseUrl).toBe("https://company.atlassian.net/wiki");
    expect(config.confluence!.spaces).toEqual(["IT", "DOCS"]);
    expect(config.confluence!.excludeLabels).toEqual(["ignore", "draft", "archived"]);
  });

  it("parses CONFLUENCE_INCLUDE_LABELS", () => {
    process.env.CONFLUENCE_BASE_URL = "https://company.atlassian.net/wiki";
    process.env.CONFLUENCE_USERNAME = "u";
    process.env.CONFLUENCE_API_TOKEN = "t";
    process.env.CONFLUENCE_SPACES = "IT";
    process.env.CONFLUENCE_INCLUDE_LABELS = "public,approved";
    expect(loadConfig().confluence!.includeLabels).toEqual(["public", "approved"]);
  });

  it("parses CONFLUENCE_EXCLUDE_LABELS override", () => {
    process.env.CONFLUENCE_BASE_URL = "https://company.atlassian.net/wiki";
    process.env.CONFLUENCE_USERNAME = "u";
    process.env.CONFLUENCE_API_TOKEN = "t";
    process.env.CONFLUENCE_SPACES = "IT";
    process.env.CONFLUENCE_EXCLUDE_LABELS = "private,secret";
    expect(loadConfig().confluence!.excludeLabels).toEqual(["private", "secret"]);
  });

  it("throws when EMBEDDING_PROVIDER is missing", () => {
    delete process.env.EMBEDDING_PROVIDER;
    expect(() => loadConfig()).toThrow();
  });

  it("throws when EMBEDDING_API_KEY is missing", () => {
    delete process.env.EMBEDDING_API_KEY;
    expect(() => loadConfig()).toThrow();
  });
});
