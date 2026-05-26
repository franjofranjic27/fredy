import { loadConfig } from "./config.js";
import { ConfluenceClient } from "./confluence/index.js";
import { createEmbeddingClient } from "./embeddings/index.js";
import { QdrantClient } from "./qdrant/index.js";
import { ingestConfluenceToQdrant, syncConfluence, ingestLocalFiles } from "./pipeline/index.js";
import { LocalFileClient } from "./local/index.js";
import { startSyncScheduler } from "./scheduler/cron.js";
import { createLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import type { Chunk } from "./chunking/types.js";

type Source = "confluence" | "files" | "all";

function parseArgs(): { command: string; source: Source; query?: string } {
  const args = process.argv.slice(2);
  let command = "";
  let source: Source = "all";
  let query: string | undefined;

  let i = 0;
  while (i < args.length) {
    if (args[i] === "--source" && args[i + 1]) {
      const val = args[i + 1] as Source;
      if (!["confluence", "files", "all"].includes(val)) {
        console.error(`Invalid --source value: ${val}. Must be confluence, files, or all.`);
        process.exit(1);
      }
      source = val;
      i += 2; // consume --source and its value
    } else {
      if (!command) {
        command = args[i];
      } else if (!query) {
        query = args[i];
      }
      i++;
    }
  }

  return { command, source, query };
}

type Config = ReturnType<typeof loadConfig>;
type EmbeddingClient = ReturnType<typeof createEmbeddingClient>;

function printHelp(): void {
  console.log(`
Fredy RAG - Confluence & Local Files to Qdrant Pipeline

Commands:
  ingest    Full ingestion of configured sources
  sync      Sync only recently modified Confluence pages
  search    Search the vector database
  daemon    Run as daemon with scheduled sync
  info      Show collection info

Options:
  --source <confluence|files|all>   Select ingestion source (default: all)

Environment variables required:
  CONFLUENCE_BASE_URL      Confluence URL (e.g., https://your-domain.atlassian.net/wiki)
  CONFLUENCE_USERNAME      Your email/username
  CONFLUENCE_API_TOKEN     API token
  CONFLUENCE_SPACES        Comma-separated space keys (e.g., IT,DOCS,KB)

  EMBEDDING_PROVIDER       openai, voyage, or cohere
  EMBEDDING_API_KEY        API key for embedding provider
  EMBEDDING_MODEL          Model name (e.g., text-embedding-3-small)

  QDRANT_URL              Qdrant URL (default: http://localhost:6333)
  QDRANT_COLLECTION       Collection name (default: confluence-pages)

Optional:
  CONFLUENCE_INCLUDE_LABELS   Only include pages with these labels
  CONFLUENCE_EXCLUDE_LABELS   Exclude pages with these labels (default: ignore,draft,archived)
  SYNC_CRON                   Cron schedule for daemon mode (default: 0 */6 * * *)

  LOCAL_FILES_ENABLED         Enable local file ingestion (default: false)
  LOCAL_FILES_DIRECTORY       Directory to scan (default: /data/files)
  LOCAL_FILES_EXTENSIONS      Comma-separated extensions (default: .md,.txt,.html)

Examples:
  node dist/index.js ingest                          # Ingest all sources
  node dist/index.js ingest --source confluence      # Ingest Confluence only
  node dist/index.js ingest --source files           # Ingest local files only
  node dist/index.js daemon                          # Run as daemon
  node dist/index.js search "how to deploy"          # Search
  node dist/index.js diagnose                        # Diagnose collection health
`);
}

async function handleIngest(
  confluence: ConfluenceClient | null,
  localFileClient: LocalFileClient | null,
  config: Config,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  source: Source,
  logger: Logger,
): Promise<void> {
  logger.info("Starting full ingestion");

  if (confluence && config.confluence) {
    logger.info("Confluence ingestion starting", {
      spaces: config.confluence.spaces.join(", "),
      excludeLabels: config.confluence.excludeLabels.join(", "),
      ...(config.confluence.includeLabels?.length
        ? { includeLabels: config.confluence.includeLabels.join(", ") }
        : {}),
    });

    const result = await ingestConfluenceToQdrant(confluence, embedding, qdrant, {
      spaces: config.confluence.spaces,
      includeLabels: config.confluence.includeLabels,
      excludeLabels: config.confluence.excludeLabels,
      chunkingOptions: config.chunking,
      logger,
    });

    logger.info("Confluence ingestion complete", {
      pagesProcessed: result.pagesProcessed,
      pagesSkipped: result.pagesSkipped,
      chunksCreated: result.chunksCreated,
      errors: result.errors.length,
    });
    for (const e of result.errors) {
      logger.error("Page ingestion error", { pageId: e.pageId, error: e.error });
    }
  } else if (source === "confluence") {
    logger.warn("Confluence not configured — set CONFLUENCE_BASE_URL to enable");
  }

  if (localFileClient) {
    logger.info("Local file ingestion starting", {
      directory: config.localFiles.directory,
      extensions: config.localFiles.extensions.join(", "),
    });

    const result = await ingestLocalFiles(localFileClient, embedding, qdrant, {
      chunkingOptions: config.chunking,
      logger,
    });

    logger.info("Local file ingestion complete", {
      filesProcessed: result.filesProcessed,
      chunksCreated: result.chunksCreated,
      errors: result.errors.length,
    });
    for (const e of result.errors) {
      logger.error("File ingestion error", { filePath: e.filePath, error: e.error });
    }
  } else if (source === "files") {
    logger.warn("Local files not enabled — set LOCAL_FILES_ENABLED=true to enable");
  }
}

async function handleSync(
  confluence: ConfluenceClient | null,
  config: Config,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  logger: Logger,
): Promise<void> {
  if (!confluence || !config.confluence) {
    logger.error("Confluence not configured — sync is only available for Confluence sources. Set CONFLUENCE_BASE_URL to enable.");
    process.exit(1);
  }

  logger.info("Starting incremental sync");

  const result = await syncConfluence(confluence, embedding, qdrant, {
    spaces: config.confluence.spaces,
    includeLabels: config.confluence.includeLabels,
    excludeLabels: config.confluence.excludeLabels,
    chunkingOptions: config.chunking,
    logger,
  });

  logger.info("Sync complete", {
    pagesUpdated: result.pagesUpdated,
    pagesDeleted: result.pagesDeleted,
    chunksCreated: result.chunksCreated,
  });
}

async function handleSearch(
  query: string | undefined,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
): Promise<void> {
  if (!query) {
    console.error("Usage: search <query>");
    process.exit(1);
  }

  console.log(`Searching for: "${query}"\n`);

  await qdrant.initCollection();
  const queryVector = await embedding.embedSingle(query);
  const results = await qdrant.search(queryVector, { limit: 5 });

  if (results.length === 0) {
    console.log("No results found.");
  } else {
    console.log(`Found ${results.length} results:\n`);
    for (const result of results) {
      console.log(`--- Score: ${result.score.toFixed(3)} ---`);
      console.log(`Title: ${result.chunk.metadata.title}`);
      console.log(`Space: ${result.chunk.metadata.spaceKey}`);
      console.log(`URL: ${result.chunk.metadata.url}`);
      console.log(`Content preview: ${result.chunk.content.slice(0, 200)}...`);
      console.log();
    }
  }
}

async function handleInfo(qdrant: QdrantClient, config: Config): Promise<void> {
  await qdrant.initCollection();
  const info = await qdrant.getCollectionInfo();
  console.log("=== Collection Info ===");
  console.log(`Collection: ${config.qdrant.collectionName}`);
  console.log(`Points count: ${info.pointsCount}`);
  console.log(`Indexed vectors: ${info.indexedVectorsCount}`);
}

async function diagnoseConfluenceComparison(
  confluence: ConfluenceClient,
  config: Config,
  qdrant: QdrantClient,
): Promise<void> {
  console.log("\n=== 3. Confluence Comparison ===");
  const storedIds = new Set(await qdrant.listStoredPageIds());
  console.log(`Stored page IDs:  ${storedIds.size}`);

  for (const spaceKey of config.confluence!.spaces) {
    console.log(`\n  Space: ${spaceKey}`);
    let confluenceCount = 0;
    let missingCount = 0;

    for await (const page of confluence.getAllPagesInSpace(spaceKey)) {
      confluenceCount++;
      if (!storedIds.has(page.id)) {
        missingCount++;
      }
    }

    console.log(`    Confluence pages: ${confluenceCount}`);
    console.log(`    Missing in Qdrant: ${missingCount}`);
    if (missingCount > 0) {
      console.log(`    ⚠  ${missingCount} page(s) not indexed`);
    }
  }
}

function diagnoseSampleChunks(samples: Chunk[]): void {
  console.log("\n=== 4. Sample Chunks ===");
  if (samples.length === 0) {
    console.log("  (no chunks to sample)");
    return;
  }
  for (const chunk of samples) {
    console.log(`  [${chunk.metadata.spaceKey}] ${chunk.metadata.title}`);
    console.log(`    chunk ${chunk.metadata.chunkIndex + 1}/${chunk.metadata.totalChunks} — ${chunk.content.slice(0, 120).replaceAll("\n", " ")}…`);
  }
}

function diagnoseHints(
  info: { pointsCount: number; indexedVectorsCount: number },
  spaceKeys: string[],
  confluenceConfigured: boolean,
): void {
  console.log("\n=== 5. Diagnostic Hints ===");
  if (info.pointsCount === 0) {
    console.log("  • Collection is empty — run 'pnpm start ingest' to populate it.");
  } else if (info.indexedVectorsCount < info.pointsCount) {
    console.log(`  • ${info.pointsCount - info.indexedVectorsCount} chunk(s) not yet indexed — Qdrant may still be building indexes.`);
  } else {
    console.log("  • Collection looks healthy.");
  }
  if (spaceKeys.length > 0 && !confluenceConfigured) {
    console.log("  • Confluence is not configured — incremental sync is disabled.");
  }
}

async function handleDiagnose(
  confluence: ConfluenceClient | null,
  config: Config,
  qdrant: QdrantClient,
): Promise<void> {
  await qdrant.initCollection();

  // 1. Collection stats
  const info = await qdrant.getCollectionInfo();
  console.log("=== 1. Collection Stats ===");
  console.log(`Collection:       ${config.qdrant.collectionName}`);
  console.log(`Total chunks:     ${info.pointsCount}`);
  console.log(`Indexed vectors:  ${info.indexedVectorsCount}`);

  // 2. Breakdown per space
  const bySpace = await qdrant.countBySpace();
  const spaceKeys = Object.keys(bySpace).sort((a, b) => a.localeCompare(b));
  console.log("\n=== 2. Chunks per Space ===");
  if (spaceKeys.length === 0) {
    console.log("  (no chunks stored)");
  } else {
    for (const key of spaceKeys) {
      console.log(`  ${key.padEnd(20)} ${bySpace[key]} chunks`);
    }
  }

  // 3. Confluence comparison (if configured)
  if (confluence && config.confluence) {
    await diagnoseConfluenceComparison(confluence, config, qdrant);
  } else {
    console.log("\n=== 3. Confluence Comparison ===");
    console.log("  (Confluence not configured — skipped)");
  }

  // 4. Sample recent chunks
  const samples = await qdrant.sampleRecentChunks(3);
  diagnoseSampleChunks(samples);

  // 5. Diagnostic hints
  diagnoseHints(info, spaceKeys, !!confluence && !!config.confluence);
}

async function handleDaemon(
  confluence: ConfluenceClient | null,
  localFileClient: LocalFileClient | null,
  config: Config,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  logger: Logger,
): Promise<void> {
  logger.info("Starting RAG daemon");

  await qdrant.initCollection();

  if (config.sync.fullSyncOnStart) {
    logger.info("Running initial full ingestion");

    if (confluence && config.confluence) {
      await ingestConfluenceToQdrant(confluence, embedding, qdrant, {
        spaces: config.confluence.spaces,
        includeLabels: config.confluence.includeLabels,
        excludeLabels: config.confluence.excludeLabels,
        chunkingOptions: config.chunking,
        logger,
      });
    }

    if (localFileClient) {
      await ingestLocalFiles(localFileClient, embedding, qdrant, {
        chunkingOptions: config.chunking,
        logger,
      });
    }
  }

  if (confluence && config.confluence) {
    const task = startSyncScheduler(confluence, embedding, qdrant, {
      cronSchedule: config.sync.cronSchedule,
      spaces: config.confluence.spaces,
      includeLabels: config.confluence.includeLabels,
      excludeLabels: config.confluence.excludeLabels,
      chunkingOptions: config.chunking,
      logger,
    });

    process.on("SIGINT", () => {
      logger.info("Stopping daemon");
      task.stop();
      process.exit(0);
    });
  } else {
    logger.warn("Confluence not configured — cron sync disabled");
    process.on("SIGINT", () => {
      logger.info("Stopping daemon");
      process.exit(0);
    });
  }

  logger.info("Daemon running — press Ctrl+C to stop");
}

async function main() {
  const { command, source, query } = parseArgs();

  if (!command || command === "help") {
    printHelp();
    return;
  }

  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });

  const confluence =
    !!config.confluence && (source === "confluence" || source === "all")
      ? new ConfluenceClient({
          baseUrl: config.confluence.baseUrl,
          username: config.confluence.username,
          apiToken: config.confluence.apiToken,
        })
      : null;

  const localFileClient =
    config.localFiles.enabled && (source === "files" || source === "all")
      ? new LocalFileClient({
          directory: config.localFiles.directory,
          extensions: config.localFiles.extensions,
        })
      : null;

  const embedding = createEmbeddingClient({
    provider: config.embedding.provider,
    apiKey: config.embedding.apiKey,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });

  const qdrant = new QdrantClient({
    url: config.qdrant.url,
    collectionName: config.qdrant.collectionName,
    apiKey: config.qdrant.apiKey,
    vectorSize: config.embedding.dimensions,
  });

  switch (command) {
    case "ingest":
      await handleIngest(confluence, localFileClient, config, embedding, qdrant, source, logger);
      break;
    case "sync":
      await handleSync(confluence, config, embedding, qdrant, logger);
      break;
    case "search":
      await handleSearch(query, embedding, qdrant);
      break;
    case "info":
      await handleInfo(qdrant, config);
      break;
    case "diagnose":
      await handleDiagnose(confluence, config, qdrant);
      break;
    case "daemon":
      await handleDaemon(confluence, localFileClient, config, embedding, qdrant, logger);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run with "help" to see available commands.');
      process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}
