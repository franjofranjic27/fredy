# fredy

fredy 🐨 makes your company knowledge available like a teammate: an AI agent
platform with a RAG pipeline over Confluence content, vector search in
PostgreSQL/pgvector and an OpenAI-compatible agent service backed by Claude.

- **Source:** [github.com/franjofranjic27/fredy](https://github.com/franjofranjic27/fredy)
- **Setup:** see the [README](https://github.com/franjofranjic27/fredy#quick-start)

## Where to start

| Page | Content |
|---|---|
| [AIOps Agent](aiops-architecture.md) | Architecture of the operations agent |
| [Confluence Importer](confluence-importer-architecture.md) | Ingestion pipeline: Confluence / files → pgvector |
| [Agent Flow](agent-flow-diagram.md) | How a chat request is processed |
| [Agent Sequence Diagram](agent-sequence-diagram.md) | Sequence view of the same flow |
| [RAG Evaluation](rag-eval-guide.md) | Evaluating retrieval quality, open architecture questions |
| [Pre-commit Hooks](precommit-hooks.md) | Local quality gates (lefthook) |
| [Agent Migration](agent-migration-plan.md) | Plan: monolith → modular ReAct agent |

For contributor setup see
[CONTRIBUTING.md](https://github.com/franjofranjic27/fredy/blob/main/CONTRIBUTING.md);
repo-wide standards live in
[franjofranjic27/.github](https://github.com/franjofranjic27/.github).
