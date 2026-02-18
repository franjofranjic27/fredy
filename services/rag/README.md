# Fredy RAG Service

Confluence pages and local files → chunked, embedded, stored in Qdrant for semantic search.

## Architecture

```
Confluence API  ──┐
                   ├─► html-chunker ──► embed() ──► Qdrant
Local Files ───────┘
```

The pipeline runs in three stages:

1. **Fetch** — Pull pages from Confluence (paginated) or scan local files
2. **Chunk** — Split HTML into semantically coherent text segments with context prefixes
3. **Embed & Store** — Generate vector embeddings and upsert into Qdrant

---

## Embedding Models

**Current default:** OpenAI `text-embedding-3-small`, 1536 dimensions

Chosen for cost-effectiveness ($0.02/1M tokens), broad availability, and strong quality for
English and code content. Configured via `EMBEDDING_PROVIDER` + `EMBEDDING_MODEL`.

| Model | Provider | Dimensions | Quality | Cost | Notes |
|-------|----------|-----------|---------|------|-------|
| `text-embedding-3-small` | OpenAI | 1536 | Good | ~$0.02/1M | **Default** |
| `text-embedding-3-large` | OpenAI | 3072 | Better | ~$0.13/1M | Higher precision |
| `voyage-2` | Voyage AI | 1024 | Good | ~$0.10/1M | Less storage |
| `voyage-large-2` | Voyage AI | 1536 | Better | ~$0.12/1M | Good for multilingual |
| `nomic-embed-text` | Ollama (local) | 768 | Moderate | Free | No external API call |

> **Important:** Changing the embedding model requires a full re-index. The Qdrant collection
> is created with a fixed vector size. Delete the collection and run `ingest` again.

---

## Chunking Strategy

A **chunk** is a text segment from a Confluence page or local file, sized to fit within
embedding API token limits while preserving enough context for relevant retrieval.

**Current settings:**

| Parameter | Value | Env var |
|-----------|-------|---------|
| Max tokens per chunk | 800 | `CHUNK_MAX_TOKENS` |
| Overlap between chunks | 100 tokens | `CHUNK_OVERLAP_TOKENS` |
| Preserve code blocks | true | `CHUNK_PRESERVE_CODE` |
| Preserve tables | true | `CHUNK_PRESERVE_TABLES` |

**How it works:**

1. HTML is split at header boundaries (`<h1>`–`<h6>`) into sections
2. Sections larger than `maxTokens` are further split at paragraph boundaries
3. Consecutive chunks overlap by `overlapTokens` to avoid losing context at boundaries
4. Each chunk gets a context prefix: `Page: Title\nPath: Ancestors\nSection: H1 > H2`

**Token estimate:** Currently uses `Math.ceil(text.length / 4)` — a rough heuristic
valid for English ASCII text. See [Todo 6](todos/06-token-estimation.md) for exact tiktoken replacement.

**Recommended chunk sizes by content type:**

| Content type | Recommended max tokens | Notes |
|---|---|---|
| FAQ / short docs | 300–500 | More precise retrieval |
| Technical documentation | 500–800 | Current setting |
| Long articles / code | 800–1200 | More context per result |

Overlap should always be 10–15% of `maxTokens`.

---

## Environment Variables

### Confluence (optional — omit to use local files only)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONFLUENCE_BASE_URL` | Yes* | — | e.g. `https://your-domain.atlassian.net/wiki` |
| `CONFLUENCE_USERNAME` | Yes* | — | Your Atlassian email |
| `CONFLUENCE_API_TOKEN` | Yes* | — | Atlassian API token |
| `CONFLUENCE_SPACES` | Yes* | — | Comma-separated space keys, e.g. `IT,DOCS,KB` |
| `CONFLUENCE_INCLUDE_LABELS` | No | — | Only ingest pages with these labels |
| `CONFLUENCE_EXCLUDE_LABELS` | No | `ignore,draft,archived` | Skip pages with these labels |

*Required only when `CONFLUENCE_BASE_URL` is set.

### Embedding

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | Yes | — | `openai`, `voyage`, or `cohere` |
| `EMBEDDING_API_KEY` | Yes | — | API key for the selected provider |
| `EMBEDDING_MODEL` | No | `text-embedding-3-small` | Model name |
| `EMBEDDING_DIMENSIONS` | No | `1536` | Vector dimensions (must match model) |

### Qdrant

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QDRANT_URL` | No | `http://localhost:6333` | Qdrant endpoint |
| `QDRANT_COLLECTION` | No | `confluence-pages` | Collection name |
| `QDRANT_API_KEY` | No | — | API key (for Qdrant Cloud) |

### Chunking

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CHUNK_MAX_TOKENS` | No | `800` | Max tokens per chunk |
| `CHUNK_OVERLAP_TOKENS` | No | `100` | Overlap between consecutive chunks |
| `CHUNK_PRESERVE_CODE` | No | `true` | Keep code blocks intact |
| `CHUNK_PRESERVE_TABLES` | No | `true` | Keep tables intact |

### Sync / Scheduler

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SYNC_CRON` | No | `0 */6 * * *` | Cron schedule for daemon mode |
| `SYNC_FULL_ON_START` | No | `false` | Run full ingest when daemon starts |

### Local Files

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOCAL_FILES_ENABLED` | No | `false` | Enable local file ingestion |
| `LOCAL_FILES_DIRECTORY` | No | `/data/files` | Directory to scan |
| `LOCAL_FILES_EXTENSIONS` | No | `.md,.txt,.html` | Comma-separated file extensions |

---

## CLI Commands

```bash
# Build first
pnpm build

# Full ingestion from all configured sources
node dist/index.js ingest

# Ingest only Confluence
node dist/index.js ingest --source confluence

# Ingest only local files
node dist/index.js ingest --source files

# Incremental sync (Confluence pages modified since last sync)
node dist/index.js sync

# Start daemon with scheduled incremental sync
node dist/index.js daemon

# Search the vector database
node dist/index.js search "how to deploy"

# Show collection stats (chunk count, indexed vectors)
node dist/index.js info

# Diagnose why the DB is sparse (planned — see Todo 2)
node dist/index.js diagnose
```

---

## Development

```bash
pnpm install
pnpm build          # tsc compile to dist/
pnpm test:run       # run tests once (vitest — planned, see Todo 4)
```

---

## Known Limitations

- **No retry on transient errors** — a 429 from OpenAI or Confluence drops the entire chunk
  batch silently. Planned fix: [Todo 3 — Retry & Resilience](todos/03-retry-resilience.md).
- **Rough token estimation** — `length / 4` over-estimates for CJK and code, under-estimates
  for some Unicode. Planned fix: [Todo 6 — js-tiktoken](todos/06-token-estimation.md).
- **No test coverage** — regressions in chunking logic are invisible.
  Planned fix: [Todo 4 — Vitest](todos/04-tests-vitest.md).
- **32-bit hash IDs for Qdrant points** — collision risk grows with large collections.
  Planned fix: replace with UUID v5 (deterministic, collision-safe).
- **No overlap protection in cron** — two syncs can run concurrently if one is slow.
  Planned fix: [Todo 3 — Retry & Resilience](todos/03-retry-resilience.md).
