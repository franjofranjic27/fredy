# Agent E2E Smoke

Boots the full Nest application against an Express adapter and drives the
OpenAI-compatible HTTP API with [supertest](https://github.com/ladjs/supertest).

Real LLM providers and the Qdrant vector store are replaced with overrides
so the test runs without external dependencies. Tests assert the wiring
end-to-end: guards, interceptors, the deterministic RAG flow and the SSE
streaming pipeline.

Run with:

```
pnpm --filter @fredy/agent test:e2e
```
