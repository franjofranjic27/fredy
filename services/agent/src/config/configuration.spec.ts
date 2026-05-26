import configuration from "./configuration";

describe("configuration", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("applies sensible defaults when no env is set", () => {
    process.env = { NODE_ENV: "test" };
    const cfg = configuration();
    expect(cfg.port).toBe(8001);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.qdrant.url).toBe("http://localhost:6333");
    expect(cfg.qdrant.collection).toBe("confluence-pages");
    expect(cfg.retrieval.defaultLimit).toBe(5);
    expect(cfg.retrieval.scoreThreshold).toBe(0.7);
    expect(cfg.session.storeType).toBe("memory");
    expect(cfg.session.ttlMs).toBe(30 * 60 * 1000);
    expect(cfg.rateLimit.rpm).toBe(60);
    expect(cfg.rateLimit.burst).toBe(10);
    expect(cfg.embedding.provider).toBe("openai");
    expect(cfg.embedding.openai.model).toBe("text-embedding-3-small");
    expect(cfg.otel.captureContent).toBe(false);
  });

  it("honours overrides from environment", () => {
    process.env = {
      PORT: "9000",
      LOG_LEVEL: "debug",
      QDRANT_URL: "http://qdrant:6333",
      QDRANT_COLLECTION: "mydocs",
      RAG_DEFAULT_RETRIEVAL_LIMIT: "8",
      RAG_SCORE_THRESHOLD: "0.5",
      EMBEDDING_PROVIDER: "voyage",
      EMBEDDING_API_KEY: "legacy-key",
      OTEL_GENAI_CAPTURE_CONTENT: "true",
      RATE_LIMIT_RPM: "120",
      RATE_LIMIT_BURST: "20",
      SESSION_STORE_TYPE: "redis",
      ROLE_TOOL_CONFIG: '{"user":["fetch_url"]}',
    };
    const cfg = configuration();
    expect(cfg.port).toBe(9000);
    expect(cfg.logLevel).toBe("debug");
    expect(cfg.qdrant.url).toBe("http://qdrant:6333");
    expect(cfg.qdrant.collection).toBe("mydocs");
    expect(cfg.retrieval.defaultLimit).toBe(8);
    expect(cfg.retrieval.scoreThreshold).toBe(0.5);
    expect(cfg.embedding.provider).toBe("voyage");
    expect(cfg.embedding.openai.apiKey).toBe("legacy-key");
    expect(cfg.otel.captureContent).toBe(true);
    expect(cfg.rateLimit.rpm).toBe(120);
    expect(cfg.rateLimit.burst).toBe(20);
    expect(cfg.session.storeType).toBe("redis");
    expect(cfg.auth.roleToolConfig).toContain("fetch_url");
  });

  it("EMBEDDING_OPENAI_API_KEY takes precedence over EMBEDDING_API_KEY", () => {
    process.env = {
      EMBEDDING_API_KEY: "old",
      EMBEDDING_OPENAI_API_KEY: "new",
    };
    expect(configuration().embedding.openai.apiKey).toBe("new");
  });

  it("falls back to default when env value is non-numeric", () => {
    process.env = { PORT: "not-a-number" };
    expect(configuration().port).toBe(8001);
  });
});
