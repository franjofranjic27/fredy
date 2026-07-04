import { z } from "zod";
import { defineConfig, parseRoleToolConfig, type RoleToolConfig } from "@fredy/agent-core";

export type EmbeddingProvider = "openai" | "voyage";
export type RerankerProvider = "none" | "cohere" | "voyage";

const DEFAULT_RERANK_MODELS: Record<Exclude<RerankerProvider, "none">, string> = {
  cohere: "rerank-v3.5",
  voyage: "rerank-2.5",
};

/** Treats unset AND empty-string env vars as absent (docker-compose passes ""). */
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const numberWithDefault = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? undefined : value),
    z.coerce.number().default(fallback),
  );

/** Env booleans: only the literal "true" enables the flag; everything else is false. */
const booleanFlag = z.preprocess((value) => value === "true" || value === true, z.boolean());

const envSchema = z.object({
  PORT: numberWithDefault(8001),
  LOG_LEVEL: z.string().default("info"),
  LLM_FALLBACK_MODEL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().default("claude-sonnet-4-5-20250929"),
  ),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MAX_TOKENS: numberWithDefault(4096),
  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: optionalString,
  OPENAI_MAX_TOKENS: numberWithDefault(4096),
  GEMINI_API_KEY: optionalString,
  GEMINI_MAX_TOKENS: numberWithDefault(4096),
  EMBEDDING_PROVIDER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["openai", "voyage"]).default("openai"),
  ),
  EMBEDDING_API_KEY: optionalString,
  EMBEDDING_MODEL: optionalString,
  EMBEDDING_OPENAI_API_KEY: optionalString,
  EMBEDDING_OPENAI_MODEL: optionalString,
  EMBEDDING_OPENAI_ENDPOINT: optionalString,
  EMBEDDING_VOYAGE_API_KEY: optionalString,
  EMBEDDING_VOYAGE_MODEL: optionalString,
  EMBEDDING_VOYAGE_ENDPOINT: optionalString,
  DATABASE_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().default("postgresql://fredy:fredy@localhost:5432/fredy"),
  ),
  CHUNKS_TABLE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().default("chunks"),
  ),
  RAG_PROFILE: optionalString,
  RAG_DEFAULT_RETRIEVAL_LIMIT: numberWithDefault(5),
  RAG_SCORE_THRESHOLD: numberWithDefault(0.7),
  RAG_TOKEN_BUDGET: numberWithDefault(3200),
  RERANKER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["none", "cohere", "voyage"]).default("none"),
  ),
  RERANK_API_KEY: optionalString,
  RERANK_MODEL: optionalString,
  RERANK_TOP_N: numberWithDefault(10),
  RERANK_THRESHOLD: numberWithDefault(0.0),
  AGENT_API_KEY: optionalString,
  AGENT_ALLOW_ANONYMOUS: booleanFlag,
  KEYCLOAK_JWKS_URL: optionalString,
  KEYCLOAK_ISSUER: optionalString,
  KEYCLOAK_AUDIENCE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().default("fredy-agent"),
  ),
  ROLE_TOOL_CONFIG: optionalString,
  RATE_LIMIT_RPM: numberWithDefault(60),
  RATE_LIMIT_BURST: numberWithDefault(10),
  TRUST_PROXY: optionalString,
  FETCH_URL_TIMEOUT_MS: numberWithDefault(10_000),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  OTEL_GENAI_CAPTURE_CONTENT: optionalString,
});

/**
 * Fastify trustProxy accepts a boolean, or a CIDR/IP allow-list string for real
 * proxy deployments. Default false so request.ip is the raw socket address and
 * X-Forwarded-For cannot be spoofed to defeat rate limiting.
 */
function parseTrustProxy(raw: string | undefined): boolean | string {
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;
  return raw;
}

export interface EmbeddingProviderConfig {
  readonly apiKey?: string;
  readonly model: string;
  readonly endpoint?: string;
}

export interface AppConfig {
  readonly port: number;
  readonly logLevel: string;
  readonly llm: {
    readonly fallbackModel: string;
    readonly anthropic: { readonly apiKey?: string; readonly maxTokens: number };
    readonly openai: {
      readonly apiKey?: string;
      readonly baseUrl?: string;
      readonly maxTokens: number;
    };
    readonly gemini: { readonly apiKey?: string; readonly maxTokens: number };
  };
  readonly embedding: {
    readonly provider: EmbeddingProvider;
    readonly openai: EmbeddingProviderConfig;
    readonly voyage: EmbeddingProviderConfig;
  };
  readonly database: { readonly url: string; readonly table: string };
  readonly ragProfile?: string;
  readonly retrieval: {
    readonly defaultLimit: number;
    readonly scoreThreshold: number;
    readonly tokenBudget: number;
  };
  readonly rerank: {
    readonly provider: RerankerProvider;
    readonly apiKey?: string;
    readonly model?: string;
    readonly topN: number;
    readonly threshold: number;
  };
  readonly auth: {
    readonly apiKey?: string;
    readonly allowAnonymous: boolean;
    readonly keycloak: {
      readonly jwksUrl?: string;
      readonly issuer?: string;
      readonly audience: string;
    };
    readonly roleToolConfig: RoleToolConfig;
  };
  readonly rateLimit: { readonly rpm: number; readonly burst: number };
  readonly trustProxy: boolean | string;
  readonly fetchUrl: { readonly timeoutMs: number };
}

/**
 * Loads and validates the whole configuration from the environment.
 * Fails fast at boot on invalid values, including a malformed ROLE_TOOL_CONFIG.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = defineConfig(envSchema, env);
  const roleToolConfig = parseRoleToolConfig(parsed.ROLE_TOOL_CONFIG);
  const rerankProvider = parsed.RERANKER;

  if (rerankProvider !== "none" && !parsed.RERANK_API_KEY) {
    throw new Error(`RERANK_API_KEY is required when RERANKER is "${rerankProvider}"`);
  }

  // Fail fast when Keycloak is configured without an issuer: an empty issuer
  // would silently disable jose's issuer check (token confusion risk).
  if (parsed.KEYCLOAK_JWKS_URL && !parsed.KEYCLOAK_ISSUER) {
    throw new Error("KEYCLOAK_ISSUER is required when KEYCLOAK_JWKS_URL is set");
  }

  // Refuse to boot fully unauthenticated unless anonymous access is opt-in.
  if (!parsed.KEYCLOAK_JWKS_URL && !parsed.AGENT_API_KEY && !parsed.AGENT_ALLOW_ANONYMOUS) {
    throw new Error(
      "No authentication configured: set KEYCLOAK_JWKS_URL or AGENT_API_KEY, " +
        "or explicitly set AGENT_ALLOW_ANONYMOUS=true for local dev",
    );
  }

  return {
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    llm: {
      fallbackModel: parsed.LLM_FALLBACK_MODEL,
      anthropic: { apiKey: parsed.ANTHROPIC_API_KEY, maxTokens: parsed.ANTHROPIC_MAX_TOKENS },
      openai: {
        apiKey: parsed.OPENAI_API_KEY,
        baseUrl: parsed.OPENAI_BASE_URL,
        maxTokens: parsed.OPENAI_MAX_TOKENS,
      },
      gemini: { apiKey: parsed.GEMINI_API_KEY, maxTokens: parsed.GEMINI_MAX_TOKENS },
    },
    embedding: {
      provider: parsed.EMBEDDING_PROVIDER,
      openai: {
        apiKey: parsed.EMBEDDING_OPENAI_API_KEY ?? parsed.EMBEDDING_API_KEY,
        model: parsed.EMBEDDING_OPENAI_MODEL ?? parsed.EMBEDDING_MODEL ?? "text-embedding-3-small",
        endpoint: parsed.EMBEDDING_OPENAI_ENDPOINT,
      },
      voyage: {
        apiKey: parsed.EMBEDDING_VOYAGE_API_KEY ?? parsed.EMBEDDING_API_KEY,
        model: parsed.EMBEDDING_VOYAGE_MODEL ?? parsed.EMBEDDING_MODEL ?? "voyage-3-lite",
        endpoint: parsed.EMBEDDING_VOYAGE_ENDPOINT,
      },
    },
    database: { url: parsed.DATABASE_URL, table: parsed.CHUNKS_TABLE },
    ragProfile: parsed.RAG_PROFILE,
    retrieval: {
      defaultLimit: parsed.RAG_DEFAULT_RETRIEVAL_LIMIT,
      scoreThreshold: parsed.RAG_SCORE_THRESHOLD,
      tokenBudget: parsed.RAG_TOKEN_BUDGET,
    },
    rerank: {
      provider: rerankProvider,
      apiKey: parsed.RERANK_API_KEY,
      model:
        rerankProvider === "none"
          ? parsed.RERANK_MODEL
          : (parsed.RERANK_MODEL ?? DEFAULT_RERANK_MODELS[rerankProvider]),
      topN: parsed.RERANK_TOP_N,
      threshold: parsed.RERANK_THRESHOLD,
    },
    auth: {
      apiKey: parsed.AGENT_API_KEY,
      allowAnonymous: parsed.AGENT_ALLOW_ANONYMOUS,
      keycloak: {
        jwksUrl: parsed.KEYCLOAK_JWKS_URL,
        issuer: parsed.KEYCLOAK_ISSUER,
        audience: parsed.KEYCLOAK_AUDIENCE,
      },
      roleToolConfig,
    },
    rateLimit: { rpm: parsed.RATE_LIMIT_RPM, burst: parsed.RATE_LIMIT_BURST },
    trustProxy: parseTrustProxy(parsed.TRUST_PROXY),
    fetchUrl: { timeoutMs: parsed.FETCH_URL_TIMEOUT_MS },
  };
}
