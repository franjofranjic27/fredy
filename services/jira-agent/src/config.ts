import { z } from "zod";
import {
  defineConfig,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
} from "@fredy/agent-core";
import { ALL_AGENT_LABELS } from "./labels.js";

/** Treats unset AND empty-string env vars as absent (docker-compose passes ""). */
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const requiredString = z.preprocess((value) => (value === "" ? undefined : value), z.string());

const numberWithDefault = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? undefined : value),
    z.coerce.number().default(fallback),
  );

const stringWithDefault = (fallback: string) =>
  z.preprocess((value) => (value === "" ? undefined : value), z.string().default(fallback));

const envSchema = z.object({
  JIRA_AGENT_PORT: numberWithDefault(8002),
  LOG_LEVEL: z.string().default("info"),
  JIRA_BASE_URL: requiredString,
  JIRA_EMAIL: requiredString,
  JIRA_API_TOKEN: requiredString,
  JIRA_PROJECT_KEY: requiredString,
  JIRA_AGENT_ACCOUNT_ID: requiredString,
  JIRA_POLL_JQL: optionalString,
  JIRA_POLL_INTERVAL_MS: numberWithDefault(60_000),
  JIRA_WEBHOOK_SECRET: optionalString,
  JIRA_TRANSITION_RESOLVE: stringWithDefault("Done"),
  JIRA_TRANSITION_WAITING: stringWithDefault("Waiting for customer"),
  TICKET_CACHE_TABLE: stringWithDefault("jira_ticket_cache"),
  LLM_FALLBACK_MODEL: stringWithDefault("claude-sonnet-4-5-20250929"),
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
  EMBEDDING_TIMEOUT_MS: numberWithDefault(15_000),
  DATABASE_URL: stringWithDefault("postgresql://fredy:fredy@localhost:5432/fredy"),
  CHUNKS_TABLE: stringWithDefault("chunks"),
  RAG_DEFAULT_RETRIEVAL_LIMIT: numberWithDefault(5),
  RAG_SCORE_THRESHOLD: numberWithDefault(0.7),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  OTEL_GENAI_CAPTURE_CONTENT: optionalString,
});

/**
 * Default reconcile JQL: only tickets assigned to the agent account that no
 * agent label has touched yet. `labels IS EMPTY OR` is load-bearing — JQL's
 * `NOT IN` silently drops issues without any labels.
 */
export function defaultPollJql(projectKey: string, agentAccountId: string): string {
  const excluded = ALL_AGENT_LABELS.join(", ");
  return (
    `project = "${projectKey}" AND assignee = "${agentAccountId}" ` +
    `AND statusCategory != Done ` +
    `AND (labels IS EMPTY OR labels NOT IN (${excluded})) ` +
    `ORDER BY created ASC`
  );
}

export interface JiraAgentConfig {
  readonly port: number;
  readonly logLevel: string;
  readonly jira: {
    readonly baseUrl: string;
    readonly email: string;
    readonly apiToken: string;
    readonly projectKey: string;
    readonly agentAccountId: string;
    readonly pollJql: string;
    readonly pollIntervalMs: number;
    readonly webhookSecret?: string;
    readonly transitions: {
      readonly resolve: string;
      readonly waitingForReporter: string;
    };
  };
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
    readonly timeoutMs: number;
  };
  readonly database: {
    readonly url: string;
    readonly chunksTable: string;
    readonly ticketCacheTable: string;
  };
  readonly retrieval: { readonly defaultLimit: number; readonly scoreThreshold: number };
}

/**
 * Loads and validates the whole configuration from the environment.
 * Fails fast at boot when the required Jira credentials are missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): JiraAgentConfig {
  const parsed = defineConfig(envSchema, env);

  return {
    port: parsed.JIRA_AGENT_PORT,
    logLevel: parsed.LOG_LEVEL,
    jira: {
      baseUrl: parsed.JIRA_BASE_URL.replace(/\/+$/, ""),
      email: parsed.JIRA_EMAIL,
      apiToken: parsed.JIRA_API_TOKEN,
      projectKey: parsed.JIRA_PROJECT_KEY,
      agentAccountId: parsed.JIRA_AGENT_ACCOUNT_ID,
      pollJql:
        parsed.JIRA_POLL_JQL ??
        defaultPollJql(parsed.JIRA_PROJECT_KEY, parsed.JIRA_AGENT_ACCOUNT_ID),
      pollIntervalMs: parsed.JIRA_POLL_INTERVAL_MS,
      webhookSecret: parsed.JIRA_WEBHOOK_SECRET,
      transitions: {
        resolve: parsed.JIRA_TRANSITION_RESOLVE,
        waitingForReporter: parsed.JIRA_TRANSITION_WAITING,
      },
    },
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
      timeoutMs: parsed.EMBEDDING_TIMEOUT_MS,
    },
    database: {
      url: parsed.DATABASE_URL,
      chunksTable: parsed.CHUNKS_TABLE,
      ticketCacheTable: parsed.TICKET_CACHE_TABLE,
    },
    retrieval: {
      defaultLimit: parsed.RAG_DEFAULT_RETRIEVAL_LIMIT,
      scoreThreshold: parsed.RAG_SCORE_THRESHOLD,
    },
  };
}
