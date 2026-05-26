import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { trace, Tracer } from "@opentelemetry/api";
import {
  EMBEDDING_CLIENT,
  EmbeddingClient,
} from "../../shared/embedding/embedding-client.interface";
import { DB, GEN_AI, setToolAttrs } from "../../shared/observability/semconv";
import { Tool, ToolResult } from "../../shared/tools/tool.interface";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { VECTOR_STORE, VectorSearchHit, VectorStore } from "./vector-store.interface";

interface VectorSearchInput {
  query: string;
  limit?: number;
  spaceKey?: string;
}

@Injectable()
export class VectorSearchTool
  implements Tool<VectorSearchInput, { hits: VectorSearchHit[] }>, OnModuleInit
{
  readonly description = {
    name: "vector_search",
    description:
      "Search the organizational knowledge base (Confluence) for relevant document chunks. Returns the most semantically similar chunks with their source URLs.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The natural-language search query." },
        limit: {
          type: "number",
          description: "Maximum number of chunks to return (default: 5).",
        },
        spaceKey: {
          type: "string",
          description: "Optional Confluence space key to filter results.",
        },
      },
      required: ["query"],
    },
  };

  private readonly logger = new Logger(VectorSearchTool.name);
  private readonly tracer: Tracer = trace.getTracer("fredy-agent.vector-search");
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
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(input: VectorSearchInput): Promise<ToolResult<{ hits: VectorSearchHit[] }>> {
    const limit = input.limit ?? this.defaultLimit;
    const span = this.tracer.startSpan("gen_ai.tool.execute");
    span.setAttribute(GEN_AI.TOOL_NAME, this.description.name);
    span.setAttribute(DB.SYSTEM, this.store.providerId);
    span.setAttribute(DB.COLLECTION_NAME, this.store.collectionName);

    try {
      const vector = await this.embedding.embedQuery(input.query);
      const filter = input.spaceKey
        ? { must: [{ key: "spaceKey", match: { value: input.spaceKey } }] }
        : undefined;

      const hits = await this.store.search(vector, {
        limit,
        scoreThreshold: this.scoreThreshold,
        filter,
      });

      span.setAttribute(GEN_AI.RETRIEVAL_RESULT_COUNT, hits.length);
      setToolAttrs(span, {
        name: this.description.name,
        success: true,
        input: { query: input.query, limit, spaceKey: input.spaceKey },
        output: { count: hits.length },
      });

      const output = formatHits(hits);
      return {
        success: true,
        output,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`vector_search failed: ${message}`);
      setToolAttrs(span, {
        name: this.description.name,
        success: false,
        input: { query: input.query, limit, spaceKey: input.spaceKey },
      });
      span.recordException(error instanceof Error ? error : new Error(message));
      return { success: false, output: `vector_search failed: ${message}` };
    } finally {
      span.end();
    }
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
