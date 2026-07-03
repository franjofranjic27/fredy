# Fredy Confluence Importer

Confluence pages, image attachments and local files → chunked, embedded, stored in
PostgreSQL/pgvector for semantic search by the agent service.

Beyond plain ingestion, the importer is a small **RAG research platform**: chunking
strategy, embedding model and parameters are bundled into *RAG profiles* so different
configurations can be ingested side by side into separate tables and A/B-compared.

```
Confluence API ──┐
Image attachments ├─► chunker (per profile) ──► embeddings (per profile) ──► pgvector
Local files ─────┘                                                            (per-profile table)
```

## Setup

Requires Python >= 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
cd services/confluence-importer
uv sync                    # install dependencies (incl. dev tools)
uv run confluence-importer --help
```

## CLI

```bash
uv run confluence-importer ingest                      # full ingest, "default" profile
uv run confluence-importer ingest --profile exp1       # ingest into profile "exp1"
uv run confluence-importer ingest --full               # truncate table first (clean rebuild)
uv run confluence-importer sync                        # incremental sync + deletion detection
uv run confluence-importer profiles list               # show configured profiles
uv run confluence-importer run                         # scheduler mode (Docker default)
```

`run` honors `SYNC_FULL_ON_START` (full ingest at boot) and then syncs on the
`SYNC_CRON` schedule. Incremental sync fetches pages modified since the last run via
CQL and additionally removes chunks of pages that were deleted in Confluence
(detected by diffing stored page ids against live ids).

## RAG Profiles (A/B experiments)

A profile = chunking strategy + parameters + embedding model + target table.

- The **`default`** profile is built from the flat env vars (`CHUNK_*`, `EMBEDDING_*`)
  and writes to `CHUNKS_TABLE` (default `chunks`).
- Additional profiles are loaded from an optional YAML file referenced by
  `PROFILES_FILE`. Each non-default profile writes to `chunks_<name>`.
- Every ingest upserts the profile into the `rag_profiles` registry table so eval
  tooling can discover which experiment produced which table.

```yaml
# profiles.yaml
profiles:
  - name: recursive_large
    chunker: recursive                  # html_section | fixed_size | recursive
    chunker_params:
      chunk_size: 3000
      chunk_overlap: 300
    embedding_provider: openai
    embedding_model: text-embedding-3-large
    embedding_dimensions: 3072
  - name: fixed_voyage
    chunker: fixed_size
    chunker_params:
      max_tokens: 512
      overlap_tokens: 64
    embedding_provider: voyage
    embedding_model: voyage-3
    embedding_dimensions: 1024
    embedding_api_key_env: VOYAGE_API_KEY   # optional, defaults to EMBEDDING_API_KEY
```

### Chunking strategies

| Name | Description | Params |
|---|---|---|
| `html_section` | Default. Splits HTML by `h1`–`h6` into sections with a header path, converts to markdown-ish text (fenced code, pipe tables, bullets), splits oversized sections by paragraphs with sentence-boundary overlap. | `max_tokens` (800), `overlap_tokens` (100) |
| `fixed_size` | Fixed token windows (tiktoken `cl100k_base`) with overlap. | `max_tokens` (800), `overlap_tokens` (100) |
| `recursive` | `RecursiveCharacterTextSplitter` (langchain-text-splitters) over the shared HTML→text output. | `chunk_size` (2000 chars), `chunk_overlap` (200) |

Every chunk gets a context prefix (`Page: …` / `Path: ancestors` / `Section: header path`)
and camelCase JSONB metadata (`chunkIndex`, `totalChunks`, `headerPath`, `contentType`).

## Media support (image attachments)

With `MEDIA_ENABLED=true`, image attachments (`image/*`, ≤ `MEDIA_MAX_BYTES`) are
downloaded and stored in the `attachments` table (binary + metadata). With
`MEDIA_CAPTION_ENABLED=true` and an `ANTHROPIC_API_KEY`, each image is captioned via
the Anthropic Messages API (`claude-haiku-4-5`) with a dense factual description in
the page's language; the caption is embedded as an extra chunk
(`{page_id}_att_{attachment_id}`, `contentType: "image"`) so images become searchable.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CONFLUENCE_BASE_URL` | – | Confluence root URL (Cloud: must end in `/wiki`). Optional — omit to run local-files-only. |
| `CONFLUENCE_USERNAME` | – | API username/email |
| `CONFLUENCE_API_TOKEN` | – | API token |
| `CONFLUENCE_SPACES` | – | Comma-separated space keys |
| `CONFLUENCE_INCLUDE_LABELS` | – | Only pages with at least one of these labels |
| `CONFLUENCE_EXCLUDE_LABELS` | `ignore,draft,archived` | Pages with any of these labels are skipped |
| `EMBEDDING_PROVIDER` | `openai` | `openai` \| `voyage` \| `cohere` |
| `EMBEDDING_API_KEY` | – | API key for the embedding provider |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Model name |
| `EMBEDDING_DIMENSIONS` | `1536` | Vector size (must match the table) |
| `DATABASE_URL` | `postgresql://fredy:fredy@localhost:5432/fredy` | PostgreSQL connection |
| `CHUNKS_TABLE` | `chunks` | Table of the default profile |
| `SYNC_CRON` | `0 */6 * * *` | Cron schedule for `run` mode |
| `SYNC_FULL_ON_START` | `false` | Full ingest at daemon start |
| `CHUNK_MAX_TOKENS` | `800` | Default profile chunk size |
| `CHUNK_OVERLAP_TOKENS` | `100` | Default profile overlap |
| `CHUNK_PRESERVE_CODE` | `true` | Reserved chunking flag |
| `CHUNK_PRESERVE_TABLES` | `true` | Reserved chunking flag |
| `LOCAL_FILES_ENABLED` | `false` | Enable local file ingestion |
| `LOCAL_FILES_DIRECTORY` | `/data/files` | Directory to scan |
| `LOCAL_FILES_EXTENSIONS` | `.md,.txt,.html` | File extensions to include |
| `PROFILES_FILE` | – | Path to the profiles YAML |
| `MEDIA_ENABLED` | `false` | Ingest image attachments |
| `MEDIA_CAPTION_ENABLED` | `false` | Caption images via Anthropic |
| `MEDIA_MAX_BYTES` | `5000000` | Max attachment size |
| `ANTHROPIC_API_KEY` | – | Required for captioning |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

## Storage schema

Per profile table (`chunks`, `chunks_<profile>`): `chunk_id TEXT PK`, `page_id`,
`space_key`, `title`, `url`, `content`, `labels TEXT[]`, `metadata JSONB`,
`embedding VECTOR(n)` with an HNSW cosine index. Similarity is
`1 - (embedding <=> query)`, identical to the previous TS implementation.

Shared tables: `rag_profiles` (experiment registry), `attachments` (image binaries
and captions).

## Development

```bash
uv run ruff check .
uv run ruff format .
uv run pytest --cov=confluence_importer --cov-report=xml --cov-report=term
```

## TODO

- OpenTelemetry tracing was removed during the Python rewrite (the TS service had
  `tracing.ts`). Re-introduce OTEL instrumentation once the tracing setup for
  Python services is decided.
