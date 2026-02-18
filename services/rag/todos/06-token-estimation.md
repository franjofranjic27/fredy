# Todo 6: Accurate Token Estimation with js-tiktoken

**Goal:** Replace the `Math.ceil(text.length / 4)` heuristic with exact token counting
using `js-tiktoken`. Affects chunk boundaries directly — especially for German, code,
and CJK content.

**Depends on:** [Todo 4](04-tests-vitest.md) — tests must exist so the chunk-boundary
shift introduced by this change can be caught by the test suite.

---

## Why This Matters

`length / 4` is tuned for English ASCII. It systematically misestimates:

| Content | `length/4` result | Actual tokens | Error |
|---------|------------------|---------------|-------|
| `"Hallo Welt"` (German) | ≈2.5 | 3 | slight under |
| `"こんにちは"` (Japanese) | 1 | 5 | 5× under — chunk TOO LARGE |
| `def foo(): return bar` | ≈5 | 8 | under — chunk TOO LARGE |
| Long English prose | ≈correct | ≈correct | — |

Under-estimated token counts lead to chunks that exceed the embedding API's token limit,
causing truncation (silent data loss) or API errors.

---

## New File: `src/chunking/tokenizer.ts`

```typescript
import { get_encoding } from "js-tiktoken";

// cl100k_base = encoding for text-embedding-3-small, GPT-3.5, GPT-4
// Singleton to avoid re-initialising the Wasm module on every call
const enc = get_encoding("cl100k_base");

export function countTokens(text: string): number {
  return enc.encode(text).length;
}
```

`get_encoding` loads a Wasm binary once; subsequent calls reuse the singleton.
`js-tiktoken` is the official OpenAI library, works with ESM (`"type": "module"`).

---

## Files to Change

### `src/chunking/html-chunker.ts`

```typescript
// Before
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// After
import { countTokens } from "./tokenizer.js";

function estimateTokens(text: string): number {
  return countTokens(text);
}
```

Also update `getOverlapText()` which currently uses `targetChars = overlapTokens * 4`
(the character-based inverse of the heuristic):

```typescript
// Before
const targetChars = overlapTokens * 4;

// After — binary search or approximate by scanning backwards token-by-token
// Simple approach: slice characters and verify with countTokens()
```

### `package.json`

```json
{
  "dependencies": {
    "js-tiktoken": "^1.0.14"
  }
}
```

---

## Test Addition (`html-chunker.test.ts`)

```typescript
it("counts tokens for CJK text correctly", () => {
  // "こんにちは" = 5 characters, but 5+ tokens (not Math.ceil(5/4) = 2)
  const tokens = countTokens("こんにちは");
  expect(tokens).toBeGreaterThan(2);
});

it("counts tokens for code correctly", () => {
  const code = "def fibonacci(n):\n    if n <= 1:\n        return n";
  const tokens = countTokens(code);
  // character heuristic: Math.ceil(47/4) = 12, actual: ~20
  expect(tokens).toBeGreaterThan(12);
});
```

---

## After Deployment

Chunk boundaries shift slightly because token counts change. A full re-index is required:

```bash
# Option A: delete collection and re-ingest
# (delete via Qdrant UI or API, then:)
node dist/index.js ingest

# Option B: use a new collection name
# Set QDRANT_COLLECTION=confluence-pages-v2 in env, then ingest
```

---

## Verification

```bash
pnpm test:run   # all tests green, including new CJK test
node dist/index.js ingest   # no "token limit exceeded" errors from OpenAI
```