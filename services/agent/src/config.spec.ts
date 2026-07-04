import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

/** Most tests don't care about auth; default to the explicit anonymous opt-in. */
function load(env: NodeJS.ProcessEnv = {}) {
  return loadConfig({ AGENT_ALLOW_ANONYMOUS: "true", ...env });
}

describe("loadConfig", () => {
  it("applies the documented defaults with an empty environment", () => {
    const config = load({});
    expect(config.port).toBe(8001);
    expect(config.logLevel).toBe("info");
    expect(config.llm.fallbackModel).toBe("claude-sonnet-4-5-20250929");
    expect(config.llm.anthropic.maxTokens).toBe(4096);
    expect(config.llm.openai.maxTokens).toBe(4096);
    expect(config.llm.gemini.maxTokens).toBe(4096);
    expect(config.embedding.provider).toBe("openai");
    expect(config.embedding.openai.model).toBe("text-embedding-3-small");
    expect(config.embedding.voyage.model).toBe("voyage-3-lite");
    expect(config.database.url).toBe("postgresql://fredy:fredy@localhost:5432/fredy");
    expect(config.database.table).toBe("chunks");
    expect(config.ragProfile).toBeUndefined();
    expect(config.retrieval).toEqual({
      defaultLimit: 5,
      scoreThreshold: 0.7,
      tokenBudget: 3200,
      historyTokenBudget: 4000,
      queryRewrite: false,
    });
    expect(config.embedding.timeoutMs).toBe(15_000);
    expect(config.rerank).toMatchObject({ provider: "none", topN: 10, threshold: 0 });
    expect(config.auth.keycloak.audience).toBe("fredy-agent");
    expect(config.auth.roleToolConfig.size).toBe(0);
    expect(config.rateLimit).toEqual({ rpm: 60, burst: 10 });
    expect(config.trustProxy).toBe(false);
  });

  it("treats empty strings as unset (docker-compose passes empty values)", () => {
    const config = load({
      AGENT_API_KEY: "",
      KEYCLOAK_JWKS_URL: "",
      RATE_LIMIT_RPM: "",
      EMBEDDING_PROVIDER: "",
    });
    expect(config.auth.apiKey).toBeUndefined();
    expect(config.auth.keycloak.jwksUrl).toBeUndefined();
    expect(config.rateLimit.rpm).toBe(60);
    expect(config.embedding.provider).toBe("openai");
  });

  it("fails fast on non-numeric numeric envs", () => {
    expect(() => load({ PORT: "not-a-number" })).toThrow(/Invalid environment configuration/);
  });

  it("fails fast on an unknown embedding provider", () => {
    expect(() => load({ EMBEDDING_PROVIDER: "cohere" })).toThrow(
      /Invalid environment configuration/,
    );
  });

  describe("authentication boot validation", () => {
    it("fails fatally when nothing is configured (no keycloak, no api key, no anon)", () => {
      expect(() => loadConfig({})).toThrow(/No authentication configured/);
    });

    it("boots in open mode only when AGENT_ALLOW_ANONYMOUS is explicitly true", () => {
      const config = loadConfig({ AGENT_ALLOW_ANONYMOUS: "true" });
      expect(config.auth.allowAnonymous).toBe(true);
      expect(config.auth.apiKey).toBeUndefined();
      expect(config.auth.keycloak.jwksUrl).toBeUndefined();
    });

    it("treats any non-true AGENT_ALLOW_ANONYMOUS value as false", () => {
      expect(() => loadConfig({ AGENT_ALLOW_ANONYMOUS: "yes" })).toThrow(
        /No authentication configured/,
      );
      expect(() => loadConfig({ AGENT_ALLOW_ANONYMOUS: "1" })).toThrow(
        /No authentication configured/,
      );
    });

    it("boots with only an API key configured", () => {
      const config = loadConfig({ AGENT_API_KEY: "s3cret" });
      expect(config.auth.apiKey).toBe("s3cret");
      expect(config.auth.allowAnonymous).toBe(false);
    });

    it("fails fatally when Keycloak JWKS is set without an issuer", () => {
      expect(() => loadConfig({ KEYCLOAK_JWKS_URL: "https://kc/certs" })).toThrow(
        /KEYCLOAK_ISSUER is required/,
      );
      expect(() =>
        loadConfig({ KEYCLOAK_JWKS_URL: "https://kc/certs", KEYCLOAK_ISSUER: "" }),
      ).toThrow(/KEYCLOAK_ISSUER is required/);
    });

    it("boots with Keycloak JWKS and issuer", () => {
      const config = loadConfig({
        KEYCLOAK_JWKS_URL: "https://kc/certs",
        KEYCLOAK_ISSUER: "https://kc/realms/fredy",
      });
      expect(config.auth.keycloak.jwksUrl).toBe("https://kc/certs");
      expect(config.auth.keycloak.issuer).toBe("https://kc/realms/fredy");
    });
  });

  describe("trustProxy", () => {
    it("defaults to false so request.ip is the raw socket address", () => {
      expect(load({}).trustProxy).toBe(false);
      expect(load({ TRUST_PROXY: "false" }).trustProxy).toBe(false);
    });

    it("maps TRUST_PROXY=true to boolean true", () => {
      expect(load({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
    });

    it("passes a CIDR/IP list string through for real proxy deployments", () => {
      expect(load({ TRUST_PROXY: "10.0.0.0/8" }).trustProxy).toBe("10.0.0.0/8");
    });
  });

  describe("ROLE_TOOL_CONFIG validation", () => {
    it("propagates the verbatim JSON parse error", () => {
      expect(() => load({ ROLE_TOOL_CONFIG: "not json" })).toThrow(
        /ROLE_TOOL_CONFIG is not valid JSON/,
      );
    });

    it("propagates the verbatim non-object error", () => {
      expect(() => load({ ROLE_TOOL_CONFIG: "[]" })).toThrow(
        "ROLE_TOOL_CONFIG must be a JSON object",
      );
    });

    it("propagates the verbatim tool array error", () => {
      expect(() => load({ ROLE_TOOL_CONFIG: '{"admin":[1]}' })).toThrow(
        "ROLE_TOOL_CONFIG.admin must be an array of tool names",
      );
    });

    it("parses a valid config into the role map", () => {
      const config = load({ ROLE_TOOL_CONFIG: '{"admin":["vector_search"]}' });
      expect(config.auth.roleToolConfig.get("admin")).toEqual(new Set(["vector_search"]));
    });
  });

  describe("embedding fallbacks", () => {
    it("EMBEDDING_API_KEY and EMBEDDING_MODEL act as shared fallbacks", () => {
      const config = load({ EMBEDDING_API_KEY: "shared", EMBEDDING_MODEL: "custom" });
      expect(config.embedding.openai.apiKey).toBe("shared");
      expect(config.embedding.openai.model).toBe("custom");
      expect(config.embedding.voyage.apiKey).toBe("shared");
      expect(config.embedding.voyage.model).toBe("custom");
    });

    it("provider-specific values win over the shared fallbacks", () => {
      const config = load({
        EMBEDDING_API_KEY: "shared",
        EMBEDDING_OPENAI_API_KEY: "openai-key",
        EMBEDDING_MODEL: "shared-model",
        EMBEDDING_VOYAGE_MODEL: "voyage-model",
      });
      expect(config.embedding.openai.apiKey).toBe("openai-key");
      expect(config.embedding.voyage.apiKey).toBe("shared");
      expect(config.embedding.voyage.model).toBe("voyage-model");
      expect(config.embedding.openai.model).toBe("shared-model");
    });
  });

  describe("reranker", () => {
    it("resolves default models per provider", () => {
      expect(load({ RERANKER: "cohere", RERANK_API_KEY: "k" }).rerank.model).toBe("rerank-v3.5");
      expect(load({ RERANKER: "voyage", RERANK_API_KEY: "k" }).rerank.model).toBe("rerank-2.5");
    });

    it("an explicit RERANK_MODEL wins", () => {
      const config = load({
        RERANKER: "cohere",
        RERANK_API_KEY: "k",
        RERANK_MODEL: "rerank-english-v3.0",
      });
      expect(config.rerank.model).toBe("rerank-english-v3.0");
    });

    it("requires RERANK_API_KEY when a reranker is enabled", () => {
      expect(() => load({ RERANKER: "cohere" })).toThrow(
        'RERANK_API_KEY is required when RERANKER is "cohere"',
      );
    });

    it("parses top-n and threshold", () => {
      const config = load({
        RERANKER: "voyage",
        RERANK_API_KEY: "k",
        RERANK_TOP_N: "3",
        RERANK_THRESHOLD: "0.5",
      });
      expect(config.rerank.topN).toBe(3);
      expect(config.rerank.threshold).toBe(0.5);
    });
  });

  it("reads keycloak and rate limit settings", () => {
    const config = loadConfig({
      KEYCLOAK_JWKS_URL: "https://kc/certs",
      KEYCLOAK_ISSUER: "https://kc/realms/fredy",
      KEYCLOAK_AUDIENCE: "custom-audience",
      RATE_LIMIT_RPM: "120",
      RATE_LIMIT_BURST: "20",
      OTEL_GENAI_CAPTURE_CONTENT: "true",
    });
    expect(config.auth.keycloak).toEqual({
      jwksUrl: "https://kc/certs",
      issuer: "https://kc/realms/fredy",
      audience: "custom-audience",
    });
    expect(config.rateLimit).toEqual({ rpm: 120, burst: 20 });
  });
});
