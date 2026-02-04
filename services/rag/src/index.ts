import { loadConfig } from "./config.js";
import { ConfluenceClient } from "./confluence/index.js";
import { createEmbeddingClient } from "./embeddings/index.js";
import { QdrantClient } from "./qdrant/index.js";
import { ingestConfluenceToQdrant, syncConfluence } from "./pipeline/index.js";
import { startSyncScheduler } from "./scheduler/cron.js";

async function main() {
  const command = process.argv[2];

  if (!command || command === "help") {
    console.log(`
Fredy RAG - Confluence to Qdrant Pipeline

Commands:
  ingest    Full ingestion of all configured Confluence spaces
  sync      Sync only recently modified pages
  search    Search the vector database
  daemon    Run as daemon with scheduled sync
  info      Show collection info

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
`);
    return;
  }

  // Load configuration
  const config = loadConfig();

  // Initialize clients
  const confluence = new ConfluenceClient({
    baseUrl: config.confluence.baseUrl,
    username: config.confluence.username,
    apiToken: config.confluence.apiToken,
  });

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
      console.log(`Spaces: ${config.confluence.spaces.join(", ")}`);
      console.log(`Exclude labels: ${config.confluence.excludeLabels.join(", ")}`);
      if (config.confluence.includeLabels?.length) {
        console.log(`Include labels: ${config.confluence.includeLabels.join(", ")}`);
      }
      console.log();

      const result = await ingestConfluenceToQdrant(confluence, embedding, qdrant, {
        spaces: config.confluence.spaces,
        includeLabels: config.confluence.includeLabels,
        excludeLabels: config.confluence.excludeLabels,
        chunkingOptions: config.chunking,
        verbose: true,
      });

      console.log("\n=== Ingestion Complete ===");
      console.log(`Pages processed: ${result.pagesProcessed}`);
      console.log(`Pages skipped: ${result.pagesSkipped}`);
      console.log(`Chunks created: ${result.chunksCreated}`);
      if (result.errors.length > 0) {
        console.log(`Errors: ${result.errors.length}`);
        result.errors.forEach((e) => console.log(`  - ${e.pageId}: ${e.error}`));
      }
      break;
    }

    case "sync": {
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
      const query = process.argv[3];
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
        await ingestConfluenceToQdrant(confluence, embedding, qdrant, {
          spaces: config.confluence.spaces,
          includeLabels: config.confluence.includeLabels,
          excludeLabels: config.confluence.excludeLabels,
          chunkingOptions: config.chunking,
          verbose: true,
        });
      }

      // Start scheduler
      const task = startSyncScheduler(confluence, embedding, qdrant, {
        cronSchedule: config.sync.cronSchedule,
        spaces: config.confluence.spaces,
        includeLabels: config.confluence.includeLabels,
        excludeLabels: config.confluence.excludeLabels,
        chunkingOptions: config.chunking,
      });

      // Keep process alive
      console.log("\nDaemon running. Press Ctrl+C to stop.\n");
      process.on("SIGINT", () => {
        console.log("\nStopping daemon...");
        task.stop();
        process.exit(0);
      });
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
