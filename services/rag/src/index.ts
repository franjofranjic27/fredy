import { loadConfig } from "./config.js";
import { ConfluenceClient } from "./confluence/index.js";
import { createEmbeddingClient } from "./embeddings/index.js";
import { QdrantClient } from "./qdrant/index.js";
import { ingestConfluenceToQdrant, syncConfluence, ingestLocalFiles } from "./pipeline/index.js";
import { LocalFileClient } from "./local/index.js";
import { startSyncScheduler } from "./scheduler/cron.js";

type Source = "confluence" | "files" | "all";

function parseArgs(): { command: string; source: Source; query?: string } {
  const args = process.argv.slice(2);
  let command = "";
  let source: Source = "all";
  let query: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1]) {
      const val = args[i + 1] as Source;
      if (!["confluence", "files", "all"].includes(val)) {
        console.error(`Invalid --source value: ${val}. Must be confluence, files, or all.`);
        process.exit(1);
      }
      source = val;
      i++; // skip next arg
    } else if (!command) {
      command = args[i];
    } else if (!query) {
      query = args[i];
    }
  }

  return { command, source, query };
}

async function main() {
  const { command, source, query } = parseArgs();

  if (!command || command === "help") {
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
`);
    return;
  }

  // Load configuration
  const config = loadConfig();

  // Determine which sources are available
  const confluenceAvailable = !!config.confluence;
  const localFilesAvailable = config.localFiles.enabled;

  // Create clients conditionally
  const confluence =
    confluenceAvailable && (source === "confluence" || source === "all")
      ? new ConfluenceClient({
          baseUrl: config.confluence!.baseUrl,
          username: config.confluence!.username,
          apiToken: config.confluence!.apiToken,
        })
      : null;

  const localFileClient =
    localFilesAvailable && (source === "files" || source === "all")
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
    case "ingest": {
      console.log("Starting full ingestion...\n");

      // Confluence ingestion
      if (confluence && config.confluence) {
        console.log(`[Confluence] Spaces: ${config.confluence.spaces.join(", ")}`);
        console.log(`[Confluence] Exclude labels: ${config.confluence.excludeLabels.join(", ")}`);
        if (config.confluence.includeLabels?.length) {
          console.log(`[Confluence] Include labels: ${config.confluence.includeLabels.join(", ")}`);
        }
        console.log();

        const result = await ingestConfluenceToQdrant(confluence, embedding, qdrant, {
          spaces: config.confluence.spaces,
          includeLabels: config.confluence.includeLabels,
          excludeLabels: config.confluence.excludeLabels,
          chunkingOptions: config.chunking,
          verbose: true,
        });

        console.log("\n=== Confluence Ingestion Complete ===");
        console.log(`Pages processed: ${result.pagesProcessed}`);
        console.log(`Pages skipped: ${result.pagesSkipped}`);
        console.log(`Chunks created: ${result.chunksCreated}`);
        if (result.errors.length > 0) {
          console.log(`Errors: ${result.errors.length}`);
          result.errors.forEach((e) => console.log(`  - ${e.pageId}: ${e.error}`));
        }
      } else if (source === "confluence" || source === "all") {
        if (source === "confluence") {
          console.log("Confluence not configured. Set CONFLUENCE_BASE_URL to enable.");
        }
      }

      // Local file ingestion
      if (localFileClient) {
        console.log(`\n[Local Files] Directory: ${config.localFiles.directory}`);
        console.log(`[Local Files] Extensions: ${config.localFiles.extensions.join(", ")}`);
        console.log();

        const result = await ingestLocalFiles(localFileClient, embedding, qdrant, {
          chunkingOptions: config.chunking,
          verbose: true,
        });

        console.log("\n=== Local File Ingestion Complete ===");
        console.log(`Files processed: ${result.filesProcessed}`);
        console.log(`Chunks created: ${result.chunksCreated}`);
        if (result.errors.length > 0) {
          console.log(`Errors: ${result.errors.length}`);
          result.errors.forEach((e) => console.log(`  - ${e.filePath}: ${e.error}`));
        }
      } else if (source === "files") {
        console.log("Local files not enabled. Set LOCAL_FILES_ENABLED=true to enable.");
      }

      break;
    }

    case "sync": {
      if (!confluence || !config.confluence) {
        console.error("Confluence not configured. Sync is only available for Confluence sources.");
        console.error("Set CONFLUENCE_BASE_URL to enable.");
        process.exit(1);
      }

      console.log("Starting incremental sync...\n");

      const result = await syncConfluence(confluence, embedding, qdrant, {
        spaces: config.confluence.spaces,
        includeLabels: config.confluence.includeLabels,
        excludeLabels: config.confluence.excludeLabels,
        chunkingOptions: config.chunking,
        verbose: true,
      });

      console.log("\n=== Sync Complete ===");
      console.log(`Pages updated: ${result.pagesUpdated}`);
      console.log(`Pages deleted: ${result.pagesDeleted}`);
      console.log(`Chunks created: ${result.chunksCreated}`);
      break;
    }

    case "search": {
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
      break;
    }

    case "info": {
      await qdrant.initCollection();
      const info = await qdrant.getCollectionInfo();
      console.log("=== Collection Info ===");
      console.log(`Collection: ${config.qdrant.collectionName}`);
      console.log(`Points count: ${info.pointsCount}`);
      console.log(`Indexed vectors: ${info.indexedVectorsCount}`);
      break;
    }

    case "daemon": {
      console.log("Starting RAG daemon...\n");

      // Initialize collection
      await qdrant.initCollection();

      // Do full sync on start if configured
      if (config.sync.fullSyncOnStart) {
        console.log("Running initial full ingestion...\n");

        if (confluence && config.confluence) {
          await ingestConfluenceToQdrant(confluence, embedding, qdrant, {
            spaces: config.confluence.spaces,
            includeLabels: config.confluence.includeLabels,
            excludeLabels: config.confluence.excludeLabels,
            chunkingOptions: config.chunking,
            verbose: true,
          });
        }

        if (localFileClient) {
          await ingestLocalFiles(localFileClient, embedding, qdrant, {
            chunkingOptions: config.chunking,
            verbose: true,
          });
        }
      }

      // Start scheduler (Confluence sync only — local files don't have incremental sync)
      if (confluence && config.confluence) {
        const task = startSyncScheduler(confluence, embedding, qdrant, {
          cronSchedule: config.sync.cronSchedule,
          spaces: config.confluence.spaces,
          includeLabels: config.confluence.includeLabels,
          excludeLabels: config.confluence.excludeLabels,
          chunkingOptions: config.chunking,
        });

        process.on("SIGINT", () => {
          console.log("\nStopping daemon...");
          task.stop();
          process.exit(0);
        });
      } else {
        console.log("Confluence not configured — cron sync disabled.");
        process.on("SIGINT", () => {
          console.log("\nStopping daemon...");
          process.exit(0);
        });
      }

      // Keep process alive
      console.log("\nDaemon running. Press Ctrl+C to stop.\n");
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run with "help" to see available commands.');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
