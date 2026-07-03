function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

export default () => ({
  port: num(process.env.PORT, 8001),
  logLevel: process.env.LOG_LEVEL ?? "info",
  llm: {
    fallbackModel: process.env.LLM_FALLBACK_MODEL,
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxTokens: num(process.env.ANTHROPIC_MAX_TOKENS, 4096),
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
      maxTokens: num(process.env.OPENAI_MAX_TOKENS, 4096),
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      maxTokens: num(process.env.GEMINI_MAX_TOKENS, 4096),
    },
  },
  embedding: {
    provider: process.env.EMBEDDING_PROVIDER ?? "openai",
    openai: {
      apiKey: process.env.EMBEDDING_OPENAI_API_KEY ?? process.env.EMBEDDING_API_KEY,
      model:
        process.env.EMBEDDING_OPENAI_MODEL ??
        process.env.EMBEDDING_MODEL ??
        "text-embedding-3-small",
      endpoint: process.env.EMBEDDING_OPENAI_ENDPOINT,
    },
    voyage: {
      apiKey: process.env.EMBEDDING_VOYAGE_API_KEY,
      model: process.env.EMBEDDING_VOYAGE_MODEL ?? "voyage-3-lite",
      endpoint: process.env.EMBEDDING_VOYAGE_ENDPOINT,
    },
  },
  database: {
    url: process.env.DATABASE_URL ?? "postgresql://fredy:fredy@localhost:5432/fredy",
    table: process.env.CHUNKS_TABLE ?? "chunks",
  },
  retrieval: {
    defaultLimit: num(process.env.RAG_DEFAULT_RETRIEVAL_LIMIT, 5),
    scoreThreshold: num(process.env.RAG_SCORE_THRESHOLD, 0.7),
    tokenBudget: num(process.env.RAG_TOKEN_BUDGET, 3200),
  },
  session: {
    ttlMs: num(process.env.SESSION_TTL_MS, 30 * 60 * 1000),
  },
  auth: {
    apiKey: process.env.AGENT_API_KEY,
    keycloak: {
      jwksUrl: process.env.KEYCLOAK_JWKS_URL,
      issuer: process.env.KEYCLOAK_ISSUER,
      audience: process.env.KEYCLOAK_AUDIENCE ?? "fredy-agent",
    },
    roleToolConfig: process.env.ROLE_TOOL_CONFIG,
  },
  rateLimit: {
    rpm: num(process.env.RATE_LIMIT_RPM, 60),
    burst: num(process.env.RATE_LIMIT_BURST, 10),
  },
  otel: {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    captureContent: bool(process.env.OTEL_GENAI_CAPTURE_CONTENT, false),
  },
});
