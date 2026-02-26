import { z } from "zod";

const ConfigSchema = z.object({
  // Confluence settings (optional — can run with only local files)
  confluence: z.object({
    baseUrl: z.string().url(),
    username: z.string(),
    apiToken: z.string(),
    spaces: z.array(z.string()).min(1),
    includeLabels: z.array(z.string()).optional(),
    excludeLabels: z.array(z.string()).default(["ignore", "draft", "archived"]),
  }).optional(),

  // Embedding settings
  embedding: z.object({
    provider: z.enum(["openai", "voyage", "cohere"]),
    apiKey: z.string(),
    model: z.string(),
    dimensions: z.number().default(1536),
  }),

  // Qdrant settings
  qdrant: z.object({
    url: z.string().default("http://localhost:6333"),
    collectionName: z.string().default("confluence-pages"),
    apiKey: z.string().optional(),
  }),

  // Chunking settings
  chunking: z.object({
    maxTokens: z.number().default(800),
    overlapTokens: z.number().default(100),
    preserveCodeBlocks: z.boolean().default(true),
    preserveTables: z.boolean().default(true),
  }),

  // Sync settings
  sync: z.object({
    cronSchedule: z.string().default("0 */6 * * *"), // Every 6 hours
    fullSyncOnStart: z.boolean().default(false),
  }),

  // Local file ingestion settings
  localFiles: z.object({
    enabled: z.boolean().default(false),
    directory: z.string().default("/data/files"),
    extensions: z.array(z.string()).default([".md", ".txt", ".html"]),
  }),

  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  // Only build confluence config when the base URL is set
  const confluenceConfig = process.env.CONFLUENCE_BASE_URL
    ? {
        baseUrl: process.env.CONFLUENCE_BASE_URL,
        username: process.env.CONFLUENCE_USERNAME,
        apiToken: process.env.CONFLUENCE_API_TOKEN,
        spaces: process.env.CONFLUENCE_SPACES?.split(",") ?? [],
        includeLabels: process.env.CONFLUENCE_INCLUDE_LABELS?.split(",").filter(Boolean),
        excludeLabels: process.env.CONFLUENCE_EXCLUDE_LABELS?.split(",").filter(Boolean) ?? [
          "ignore",
          "draft",
          "archived",
        ],
      }
    : undefined;

  return ConfigSchema.parse({
    confluence: confluenceConfig,
    embedding: {
      provider: process.env.EMBEDDING_PROVIDER as "openai" | "voyage" | "cohere",
      apiKey: process.env.EMBEDDING_API_KEY,
      model: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
      dimensions: Number.parseInt(process.env.EMBEDDING_DIMENSIONS ?? "1536", 10),
    },
    qdrant: {
      url: process.env.QDRANT_URL ?? "http://localhost:6333",
      collectionName: process.env.QDRANT_COLLECTION ?? "confluence-pages",
      apiKey: process.env.QDRANT_API_KEY || undefined,
    },
    chunking: {
      maxTokens: Number.parseInt(process.env.CHUNK_MAX_TOKENS ?? "800", 10),
      overlapTokens: Number.parseInt(process.env.CHUNK_OVERLAP_TOKENS ?? "100", 10),
      preserveCodeBlocks: process.env.CHUNK_PRESERVE_CODE !== "false",
      preserveTables: process.env.CHUNK_PRESERVE_TABLES !== "false",
    },
    sync: {
      cronSchedule: process.env.SYNC_CRON ?? "0 */6 * * *",
      fullSyncOnStart: process.env.SYNC_FULL_ON_START === "true",
    },
    localFiles: {
      enabled: process.env.LOCAL_FILES_ENABLED === "true",
      directory: process.env.LOCAL_FILES_DIRECTORY ?? "/data/files",
      extensions: process.env.LOCAL_FILES_EXTENSIONS?.split(",").filter(Boolean) ?? [
        ".md",
        ".txt",
        ".html",
      ],
    },
    logLevel: (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error",
  });
}
