# Fredy Eval

Offline evaluation service for the Fredy RAG stack. Measures retrieval quality of the
`confluence-importer → Qdrant → agent` pipeline using a golden dataset and standard
information-retrieval metrics.

## What it does

For every query in `data/golden.jsonl`:

1. Embed the query with the configured embedding provider (same one the agent uses).
2. Search the live Qdrant collection (read-only) for the top-N chunks.
3. Compare retrieved `chunkId`s against the expected `relevantChunkIds`.
4. Compute per-query metrics, then aggregate (mean) across all queries.
5. Write a JSON report to `reports/eval-<timestamp>.json` and stream the same JSON to
   stdout. A human-readable summary is written to stderr.

The eval runner queries Qdrant **directly** — it does not go through the agent's
HTTP API. This isolates retrieval quality from prompt/tool-orchestration effects.

## Running

```bash
# Generate the golden dataset (separate service / agent — not part of this service)
pnpm --filter @fredy/eval generate-dataset   # TODO: provided by the dataset-generator agent

# Run the evaluation
pnpm --filter @fredy/eval eval
```

If `data/golden.jsonl` does not exist, the runner exits with code 2 and a message
telling you to run the dataset generator first.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `EMBEDDING_PROVIDER` | yes | — | `openai` / `voyage` / `cohere` (must match the importer) |
| `EMBEDDING_API_KEY` | yes | — | API key for the embedding provider |
| `EMBEDDING_MODEL` | yes | — | Model name (must match the importer's model) |
| `EMBEDDING_DIMENSIONS` | no | provider default | Vector size; must match the Qdrant collection |
| `QDRANT_URL` | no | `http://localhost:6333` | Qdrant endpoint |
| `QDRANT_COLLECTION` | no | `confluence-pages` | Collection to query |
| `QDRANT_API_KEY` | no | — | Required only for Qdrant Cloud |
| `EVAL_DATASET_PATH` | no | `data/golden.jsonl` | Path to the golden dataset |
| `EVAL_K_VALUES` | no | `1,3,5,10` | Comma-separated `k` values |
| `EVAL_SEARCH_LIMIT` | no | `max(EVAL_K_VALUES)` | How many hits to fetch from Qdrant per query |
| `EVAL_SCORE_THRESHOLD` | no | `0` | Score filter at Qdrant; kept at `0` so recall is honest |
| `EVAL_REPORTS_DIR` | no | `reports` | Where JSON reports are written |

> **Why score threshold = 0?** The agent uses `scoreThreshold = 0.7` in production, but
> for evaluation we want to see how the underlying ranking looks without that cut. The
> threshold is a separate tuning knob — measure first, tune after.

## Golden dataset schema

Each line in `data/golden.jsonl` is one JSON object:

```json
{
  "queryId": "q_001",
  "query": "Wie konfiguriere ich den Confluence-Import?",
  "relevantChunkIds": ["12345_0", "12345_1"],
  "source": "synthetic",
  "metadata": {
    "sourcePageId": "12345",
    "sourcePageTitle": "Confluence Import Setup",
    "sourceSpaceKey": "DOCS",
    "generatedBy": "claude-opus-4-7",
    "generatedAt": "2026-05-26T12:00:00Z"
  }
}
```

Chunk IDs follow the importer's convention: `<pageId>_<chunkIndex>`.

Validation rules (enforced via Zod):

- `queryId`, `query`, `source` — non-empty strings, `queryId` unique
- `relevantChunkIds` — non-empty array of non-empty strings
- `metadata` — free-form object (extra fields are tolerated)
- Empty lines in the file are skipped
- Schema violations abort with the offending line number

## Metrics

All metrics use **binary relevance** (a chunk is either relevant or not).

| Metric | What it tells you |
|---|---|
| **Precision@k** | Of the top-k retrieved chunks, what fraction is actually relevant. Low → too much noise. |
| **Recall@k** | Of all relevant chunks for a query, what fraction did we recover in the top-k. Low → missing answers. |
| **NDCG@k** | Like Recall@k but rewards relevant chunks that appear earlier in the ranking. Sensitive to order. |
| **HitRate** | 1 if at least one relevant chunk appears anywhere in the top-N, else 0. The most lenient signal. |
| **MRR** | Mean reciprocal rank across queries: `mean(1 / rank_of_first_relevant_hit)`. Captures how quickly the first useful chunk appears. |

Aggregation is a simple mean over all queries.

## Sample output

stderr (human-readable summary):

```
Fredy Eval — Retrieval Quality Report
==================================================
Generated:        2026-05-26T13:42:17.083Z
Dataset:          data/golden.jsonl (42 queries)
Qdrant:           confluence-pages
Embedding:        openai / text-embedding-3-small
Search limit:     10
Score threshold:  0

Aggregated metrics (mean over queries):

k   Precision@k  Recall@k  NDCG@k
--  -----------  --------  ------
1   0.7619       0.4524    0.7619
3   0.5556       0.7619    0.7032
5   0.4143       0.8571    0.7384
10  0.2429       0.9286    0.7691

HitRate:          0.9524
MRR:              0.8175

Report written to: /…/services/eval/reports/eval-2026-05-26T13-42-17-083Z.json
```

stdout: the same data as a JSON document, suitable for piping into other tools or
storing in CI artifacts.

## Architecture

```
data/golden.jsonl              ← golden dataset (jsonl, Zod-validated)
        │
        ▼
   dataset/loader  ──►  runner/eval-runner ──►  embedding/client  ──►  OpenAI/Voyage/Cohere
                              │                                    
                              ├──►  qdrant/client (read-only)  ──►  Qdrant
                              │
                              └──►  metrics/{precision,recall,mrr,ndcg,hit-rate}
                                          │
                                          ▼
                                  reports/eval-<ts>.json + stdout/stderr
```

## Limitations / TODOs

- **No end-to-end evaluation via the agent's HTTP API.** Eval currently bypasses
  the agent and queries Qdrant directly. An end-to-end mode (measuring the actual
  agent answer quality, including tool selection and prompt effects) is out of
  scope for retrieval-quality measurement.
- **Binary relevance only.** Graded relevance (e.g. 0/1/2) would require schema
  changes and a different NDCG implementation.
- **No statistical significance tests** between runs. Useful for A/B comparisons
  of embedding models or chunk strategies — but not in scope yet.
