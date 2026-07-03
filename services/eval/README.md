# rag-eval

Retrieval evaluation harness for the Fredy RAG stack. It produces **evidence** which
RAG configuration is better: a golden dataset (queries + expected chunk ids), standard
IR metrics, optional reranking, and A/B comparison across RAG profiles.

## Concept

```
golden set (JSONL)  ──►  per query: embed → pgvector search → (rerank) → metrics
                                        │
                                        ▼
                     JSON + Markdown reports, A/B comparison table
```

1. **Golden dataset** — `rag-eval generate` samples chunks from a profile's pgvector
   table (deterministic, seeded) and asks Claude to write realistic user questions that
   are answered by exactly that chunk. Expected relevant chunks = the source chunk plus
   its same-page neighbours.
2. **Metrics** — for every query the retrieved ranking is scored with precision@k,
   recall@k, nDCG@k, MRR and hit-rate (binary relevance), then averaged over all queries.
3. **A/B evidence** — `rag-eval compare` runs the *same* dataset against multiple
   profiles and/or rerankers and renders one table with the winner per metric bolded.

The runner queries the chunk tables **directly** (read-only) — retrieval quality is
measured in isolation from prompt/tool-orchestration effects.

## RAG profiles

The importer registers each ingestion configuration in the `rag_profiles` table
(chunker, embedding provider/model/dimensions, chunk table name). `rag-eval` reads
that registry, so `--profile exp1` automatically evaluates the right table with the
right embedding model.

If `rag_profiles` does not exist (or the profile row is missing), the tool falls back
to env config (`VECTOR_TABLE`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`,
`EMBEDDING_DIMENSIONS`) and works against a plain `chunks` table.

## The research loop

```bash
# 1. Ingest the same corpus under two profiles (done with the importer)
confluence-importer run --profile default
confluence-importer run --profile exp1     # e.g. different chunker or embedding model

# 2. Generate the golden set ONCE (from the baseline profile)
rag-eval generate --profile default --num-chunks 50 --questions-per-chunk 2 \
  --seed 42 --out data/golden.jsonl

# 3. Evaluate a single configuration
rag-eval run --dataset data/golden.jsonl --profile default

# 4. Same configuration + reranker (report shows pre- AND post-rerank metrics)
rag-eval run --dataset data/golden.jsonl --profile default \
  --reranker cohere --rerank-threshold 0.35

# 5. A/B comparison — the actual evidence
rag-eval compare --dataset data/golden.jsonl \
  --profile default --profile exp1 --reranker cohere
```

`compare` writes `reports/comparison_<timestamp>.md` with one row per configuration
(rows = configs, columns = precision@k / recall@k / nDCG@k / MRR / hit-rate) and the
best value per column bolded. Individual JSON + Markdown reports are written as
`reports/<timestamp>_<profile>[_<reranker>].json|md`.

## Setup

```bash
uv sync --all-groups
uv run rag-eval --help
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://fredy:fredy@localhost:5432/fredy` | Postgres with pgvector |
| `ANTHROPIC_API_KEY` | — | Required by `generate` |
| `EMBEDDING_API_KEY` | — | Required by `run` / `compare` |
| `EMBEDDING_PROVIDER` | — | Fallback when no profile row: `openai` / `voyage` / `cohere` |
| `EMBEDDING_MODEL` | — | Fallback embedding model |
| `EMBEDDING_DIMENSIONS` | provider default | Fallback vector size |
| `VECTOR_TABLE` | `chunks` | Fallback chunk table (legacy alias: `CHUNKS_TABLE`) |
| `EVAL_K_VALUES` | `1,3,5,10` | Comma-separated k values |
| `EVAL_SEARCH_LIMIT` | `20` | Hits fetched from pgvector per query |
| `EVAL_SCORE_THRESHOLD` | `0.0` | Similarity cutoff (keep 0 so recall is honest) |
| `EVAL_REPORTS_DIR` | `reports` | Report output directory |
| `RERANKER` | `none` | `none` / `cohere` / `voyage` |
| `RERANK_API_KEY` | — | Required when a reranker is active |
| `RERANK_MODEL` | `rerank-v3.5` (cohere), `rerank-2.5` (voyage) | Rerank model |
| `RERANK_TOP_N` | `10` | Candidates kept after reranking |
| `RERANK_THRESHOLD` | `0.0` | Drop reranked results below this relevance score |

## Golden dataset format

One JSON object per line (`data/golden.jsonl`) — stable since the TypeScript version,
existing datasets keep loading:

```json
{
  "queryId": "q_001",
  "query": "Wie konfiguriere ich den Confluence-Import?",
  "relevantChunkIds": ["12345_0", "12345_1"],
  "source": "synthetic",
  "metadata": { "sourcePageId": "12345", "sourcePageTitle": "Confluence Import Setup" }
}
```

Validation: `queryId` unique and non-empty, `query`/`source` non-empty,
`relevantChunkIds` a non-empty array of non-empty strings, `metadata` free-form,
blank lines skipped, schema violations abort with the offending line number.

## Metrics

All metrics use binary relevance.

| Metric | What it tells you |
|---|---|
| **Precision@k** | Of the top-k retrieved chunks, the fraction that is relevant. Low → noise. |
| **Recall@k** | Of all relevant chunks, the fraction recovered in the top-k. Low → missing answers. |
| **nDCG@k** | Rank-aware: relevant chunks earlier in the list score higher. |
| **Hit-rate** | 1 if any relevant chunk was retrieved at all. The most lenient signal. |
| **MRR** | Mean of `1 / rank of first relevant hit`. How fast the first useful chunk appears. |

With a reranker active, reports contain both `aggregated` (pre-rerank) and
`rerankedAggregated` (post-rerank) so the reranker's lift is directly visible.

## Development

```bash
uv run pytest --cov=rag_eval --cov-report=xml --cov-report=term
uv run ruff check .
uv run ruff format .
```
