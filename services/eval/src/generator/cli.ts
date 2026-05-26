import { resolve } from "node:path";
import { AnthropicClient } from "./anthropic-client.js";
import { QdrantSampler } from "./qdrant-sampler.js";
import { generateDataset } from "./index.js";
import type { GeneratorConfig } from "./types.js";

interface CliArgs {
  count: number;
  spaceKey?: string;
  output: string;
  seed: number;
  concurrency: number;
  verifyNeighbours: boolean;
}

const DEFAULTS: CliArgs = {
  count: 50,
  output: "data/golden.jsonl",
  seed: 42,
  concurrency: 4,
  verifyNeighbours: false,
};

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      i++;
      return value;
    };

    switch (arg) {
      case "--count":
        args.count = parsePositiveInt(arg, next());
        break;
      case "--space":
        args.spaceKey = next();
        break;
      case "--output":
        args.output = next();
        break;
      case "--seed":
        args.seed = parsePositiveInt(arg, next());
        break;
      case "--concurrency":
        args.concurrency = parsePositiveInt(arg, next());
        break;
      case "--verify-neighbours":
        args.verifyNeighbours = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parsePositiveInt(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} expects a positive integer, got "${raw}"`);
  }
  return n;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: generate-dataset [options]",
      "",
      "Options:",
      "  --count <n>            Number of queries to generate (default 50)",
      "  --space <key>          Restrict sampling to a single Confluence space",
      "  --output <path>        Output JSONL path (default data/golden.jsonl)",
      "  --seed <n>             RNG seed for reproducible sampling (default 42)",
      "  --concurrency <n>      Parallel LLM calls (default 4)",
      "  --verify-neighbours    Verify same-page neighbour chunks via LLM",
      "  -h, --help             Show this help",
      "",
    ].join("\n"),
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const qdrantUrl = process.env.QDRANT_URL ?? "http://localhost:6333";
  const qdrantCollection = process.env.QDRANT_COLLECTION ?? "confluence-pages";
  const qdrantApiKey = process.env.QDRANT_API_KEY || undefined;

  const sampler = new QdrantSampler({
    url: qdrantUrl,
    collectionName: qdrantCollection,
    apiKey: qdrantApiKey,
  });
  const llm = new AnthropicClient({ apiKey });

  const config: GeneratorConfig = {
    count: args.count,
    spaceKey: args.spaceKey,
    outputPath: resolve(process.cwd(), args.output),
    seed: args.seed,
    concurrency: args.concurrency,
  };

  process.stderr.write(
    `Generating ${config.count} queries (seed=${config.seed}, concurrency=${config.concurrency})\n`,
  );

  const records = await generateDataset(config, {
    sampler,
    llm,
    verifyNeighbours: args.verifyNeighbours,
    onProgress: (event) => {
      const tag = event.status === "ok" ? "generated" : "skipped";
      const reason = event.reason ? ` (${event.reason})` : "";
      process.stderr.write(`[${event.index}/${event.total}] ${tag} ${event.queryId}${reason}\n`);
    },
  });

  process.stderr.write(
    `Done: ${records.length} records written to ${config.outputPath} ` +
      `(${config.count - records.length} skipped)\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
