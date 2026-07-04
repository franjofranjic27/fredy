import type { Logger } from "@fredy/agent-core";
import type { AppConfig, EmbeddingProvider, EmbeddingProviderConfig } from "./config.js";
import type { QueryablePool } from "./tools/pgvector.js";
import { sanitizeIdentifier } from "./tools/pgvector.js";

export interface ResolvedRagProfile {
  readonly tableName: string;
  readonly embeddingProvider: EmbeddingProvider;
  readonly embedding: EmbeddingProviderConfig;
  readonly source: "profile" | "env";
}

interface ProfileRow {
  table_name: string;
  embedding_provider: string;
  embedding_model: string;
}

const UNDEFINED_TABLE = "42P01";

function envProfile(config: AppConfig): ResolvedRagProfile {
  const provider = config.embedding.provider;
  return {
    tableName: config.database.table,
    embeddingProvider: provider,
    embedding: config.embedding[provider],
    source: "env",
  };
}

/**
 * Resolves the chunk table and embedding settings. When RAG_PROFILE is set,
 * the `rag_profiles` registry written by the Python importer wins; missing
 * profile rows (or a missing registry table) fall back to env config.
 */
export async function resolveRagProfile(
  pool: QueryablePool,
  config: AppConfig,
  logger: Logger,
): Promise<ResolvedRagProfile> {
  if (!config.ragProfile) return envProfile(config);

  let rows: unknown[];
  try {
    ({ rows } = await pool.query(
      "SELECT table_name, embedding_provider, embedding_model FROM rag_profiles WHERE profile_name = $1",
      [config.ragProfile],
    ));
  } catch (error) {
    if ((error as { code?: string }).code === UNDEFINED_TABLE) {
      logger.warn(
        `RAG profile "${config.ragProfile}" requested but rag_profiles table does not exist — falling back to env config (table "${config.database.table}")`,
      );
      return envProfile(config);
    }
    throw error;
  }

  const row = rows[0] as ProfileRow | undefined;
  if (!row) {
    logger.warn(
      `RAG profile "${config.ragProfile}" not found in rag_profiles — falling back to env config (table "${config.database.table}")`,
    );
    return envProfile(config);
  }

  const provider = row.embedding_provider;
  if (provider !== "openai" && provider !== "voyage") {
    throw new Error(
      `RAG profile "${config.ragProfile}" uses unsupported embedding provider "${provider}" (agent supports openai|voyage)`,
    );
  }

  return {
    tableName: sanitizeIdentifier(row.table_name),
    embeddingProvider: provider,
    embedding: {
      apiKey: config.embedding[provider].apiKey,
      model: row.embedding_model,
      endpoint: config.embedding[provider].endpoint,
    },
    source: "profile",
  };
}
