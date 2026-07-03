import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AttributeValue } from "@opentelemetry/api";
import {
  EMBEDDING_CLIENT,
  EmbeddingClient,
} from "../../shared/embedding/embedding-client.interface";
import { DB } from "../../shared/observability/semconv";
import { ToolContext, ToolDefinition, ToolResult } from "../../shared/tools/tool.interface";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { vectorSearchInputSchema, VectorSearchInput } from "./vector-search.schema";
import { VECTOR_STORE, VectorSearchHit, VectorStore } from "./vector-store.interface";

@Injectable()
export class VectorSearchTool
  implements ToolDefinition<VectorSearchInput, { hits: VectorSearchHit[] }>, OnModuleInit
{
  readonly name = "vector_search";
  readonly description =
    "Search the organizational knowledge base (Confluence) for relevant document chunks. Returns the most semantically similar chunks with their source URLs.";
  readonly inputSchema = vectorSearchInputSchema;
  readonly staticAttributes: Record<string, AttributeValue>;

  private readonly defaultLimit: number;
  private readonly scoreThreshold: number;

  constructor(
    @Inject(EMBEDDING_CLIENT) private readonly embedding: EmbeddingClient,
    @Inject(VECTOR_STORE) private readonly store: VectorStore,
    private readonly registry: ToolRegistryService,
    config: ConfigService,
  ) {
    this.defaultLimit = config.get<number>("retrieval.defaultLimit") ?? 5;
    this.scoreThreshold = config.get<number>("retrieval.scoreThreshold") ?? 0.7;
    this.staticAttributes = {
      [DB.SYSTEM]: store.providerId,
      [DB.COLLECTION_NAME]: store.collectionName,
    };
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    input: VectorSearchInput,
    _ctx: ToolContext,
  ): Promise<ToolResult<{ hits: VectorSearchHit[] }>> {
    const limit = input.limit ?? this.defaultLimit;
    const vector = await this.embedding.embedQuery(input.query);
    const filter = input.spaceKey ? { spaceKey: input.spaceKey } : undefined;

    const hits = await this.store.search(vector, {
      limit,
      scoreThreshold: this.scoreThreshold,
      filter,
    });

    return {
      output: formatHits(hits),
      data: { hits },
      metadata: {
        chunks: hits.map((h) => ({
          id: String(h.id),
          score: h.score,
          url: h.payload.url,
          title: h.payload.title,
          spaceKey: h.payload.spaceKey,
        })),
      },
    };
  }
}

function formatHits(hits: VectorSearchHit[]): string {
  if (hits.length === 0) return "No relevant documents found.";
  return hits
    .map((h, i) => {
      const title = h.payload.title ?? `Result ${i + 1}`;
      const url = h.payload.url ? `\nSource: ${h.payload.url}` : "";
      return `### ${title} (score=${h.score.toFixed(3)})${url}\n${h.payload.content}`;
    })
    .join("\n\n---\n\n");
}
