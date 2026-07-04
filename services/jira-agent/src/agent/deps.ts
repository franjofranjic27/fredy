import type { EmbeddingClient, Logger, PgVectorStore } from "@fredy/agent-core";
import type { JiraClient } from "../jira/jira-client.js";
import type { TicketCacheStore } from "../cache/ticket-cache.js";
import type { TicketHandlerRegistry } from "../handlers/handler.js";
import type { CreateModelFactory, InvokeStructured } from "./llm.js";

/**
 * Everything the triage graph nodes may touch. The graph performs Jira READS
 * and LLM/embedding calls only — all writes go through the action executor
 * after the graph has concluded.
 */
export interface TriageGraphDeps {
  readonly client: JiraClient;
  readonly embeddings: EmbeddingClient;
  readonly cache: TicketCacheStore;
  readonly chunks: PgVectorStore;
  readonly handlers: TicketHandlerRegistry;
  readonly createModel: CreateModelFactory;
  readonly invokeStructured: InvokeStructured;
  readonly projectKey: string;
  readonly agentAccountId: string;
  readonly retrieval: { readonly defaultLimit: number; readonly scoreThreshold: number };
  readonly logger: Logger;
}
