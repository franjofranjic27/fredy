import { z } from "zod";

const EnvSchema = z.object({
  QDRANT_URL: z.string().url().default("http://localhost:6333"),
  QDRANT_COLLECTION: z.string().min(1).default("confluence-pages"),
  QDRANT_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(["openai", "voyage", "cohere"]),
  EMBEDDING_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
  EVAL_DATASET_PATH: z.string().min(1).default("data/golden.jsonl"),
  EVAL_K_VALUES: z.string().default("1,3,5,10"),
  EVAL_SEARCH_LIMIT: z.coerce.number().int().positive().optional(),
  EVAL_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0),
  EVAL_REPORTS_DIR: z.string().min(1).default("reports"),
});

export interface EvalConfig {
  qdrant: {
    url: string;
    collection: string;
    apiKey?: string;
  };
  embedding: {
    provider: "openai" | "voyage" | "cohere";
    apiKey: string;
    model: string;
    dimensions?: number;
  };
  dataset: {
    path: string;
  };
  runner: {
    kValues: number[];
    searchLimit: number;
    scoreThreshold: number;
    reportsDir: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EvalConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const kValues = parseKValues(e.EVAL_K_VALUES);
  const searchLimit = e.EVAL_SEARCH_LIMIT ?? Math.max(...kValues);

  return {
    qdrant: {
      url: e.QDRANT_URL,
      collection: e.QDRANT_COLLECTION,
      apiKey: e.QDRANT_API_KEY,
    },
    embedding: {
      provider: e.EMBEDDING_PROVIDER,
      apiKey: e.EMBEDDING_API_KEY,
      model: e.EMBEDDING_MODEL,
      dimensions: e.EMBEDDING_DIMENSIONS,
    },
    dataset: {
      path: e.EVAL_DATASET_PATH,
    },
    runner: {
      kValues,
      searchLimit,
      scoreThreshold: e.EVAL_SCORE_THRESHOLD,
      reportsDir: e.EVAL_REPORTS_DIR,
    },
  };
}

function parseKValues(raw: string): number[] {
  const values = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`EVAL_K_VALUES contains invalid value: "${s}" (expected positive integers)`);
      }
      return n;
    });
  if (values.length === 0) {
    throw new Error("EVAL_K_VALUES must contain at least one positive integer");
  }
  return [...new Set(values)].sort((a, b) => a - b);
}
