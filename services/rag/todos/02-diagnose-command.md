# Todo 2: `diagnose` CLI Command

**Goal:** Make it visible why the vector DB is sparse or empty — without any write operations.

**Likely root cause today:** `SYNC_FULL_ON_START=true` triggers a full ingest on daemon start.
A single 429 or network hiccup during `embedding.embed()` aborts the entire chunk batch and
the error lands silently in `result.errors[]` (only printed with `verbose: true`). With no
retry logic, those pages are permanently missing until the next manual `ingest`.

---

## Files to Change

| File | Change |
|------|--------|
| `src/qdrant/client.ts` | Add three new diagnostic methods |
| `src/index.ts` | Add `case "diagnose":` to the switch statement |

---

## New Methods on `QdrantClient`

```typescript
// Counts stored chunks grouped by spaceKey payload field.
// Uses client.scroll() with with_payload: true, no_payload_keys: ["content", "vector"]
async countBySpace(): Promise<Record<string, number>>

// Returns all unique pageId values currently stored.
// Needed to compare against live Confluence page list.
async listStoredPageIds(): Promise<string[]>

// Returns the N most recently modified chunks (sorted by lastModified payload field).
async sampleRecentChunks(n: number): Promise<Array<{
  title: string;
  spaceKey: string;
  lastModified: string;
  chunkIndex: number;
}>>
```

All three use `this.client.scroll()` with `with_payload: true`.
`countBySpace` and `listStoredPageIds` scroll through all points using `offset` pagination.

---

## Command Output

```
=== RAG Diagnostics ===
Qdrant: http://localhost:6333 | Collection: confluence-pages

[1] Collection stats
    Total chunks : 42
    Indexed vectors: 42

[2] Breakdown by space
    SOFTWAREEN : 42

[3] Most recent 5 chunks
    "How to deploy"  (SOFTWAREEN)  chunk 0  —  2024-01-10
    "API reference"  (SOFTWAREEN)  chunk 2  —  2024-01-09
    ...

[4] Confluence comparison
    Configured spaces : SOFTWAREEN
    Pages via API     : 87
    After label filter: 72
    Unique pageIds in Qdrant: 6

[5] Diagnosis hints
    ⚠  66 pages in Confluence, only 6 in Qdrant
    →  Ingestion failed or was interrupted
    →  No retry logic — transient errors silently drop batches
    →  Fix: node dist/index.js ingest
    →  Permanent fix: implement Todo 3 (Retry & Resilience)
```

---

## Implementation Notes

- The command is **read-only** — no upserts, no deletes, no collection mutations.
- Section [4] requires a live Confluence API call (uses the existing `ConfluenceClient`).
  If Confluence is not configured, print a note and skip section [4].
- Section [5] hints are generated from the ratio `qdrantPageCount / confluencePageCount`.
  Threshold: warn if ratio < 0.9 (>10% pages missing).
- `listStoredPageIds()` may be slow on large collections. Add a note to the output
  ("scanning N points…") so the user isn't confused by the pause.

---

## Verification

```bash
node dist/index.js diagnose
```

Expected: prints all 5 sections, shows correct chunk count, flags missing pages if any.