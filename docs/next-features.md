# Fredy — Next Feature Roadmap

This document describes planned features for the Fredy AI Agent platform. Features are grouped by theme and ordered roughly by implementation value vs. effort.

---

## RAG Pipeline

### RAG Evaluation Pipeline

**What:** A set of test queries with known expected answers used to measure retrieval quality (recall, MRR, NDCG) after any change to chunking strategy, embedding model, or collection config.

**Why:** It's currently impossible to know if a change to chunk size, overlap, or embedding model improves or degrades retrieval quality. An evaluation dataset makes this measurable.

**Scope:** A script `services/rag/src/eval/` that runs a query set, compares retrieved chunks against expected sources, and outputs a quality score. Golden dataset stored in `data/eval/`.

---

## Multi-Agent Orchestration (Future)

**What:** Route different types of queries to specialized agents (e.g., a "documentation agent" that searches Confluence/Jira, a "deployment agent" with access to CI/CD tools, a "monitoring agent" with access to metrics).

**Why:** A single agent with access to all tools becomes hard to reason about and token-heavy. Specialised agents with narrow tool sets are more accurate and cheaper.

**Scope:** Requires an orchestrator layer that classifies intent and delegates to sub-agents. This is the largest architectural change on this list and builds on all other features above being stable first.
