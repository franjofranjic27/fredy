import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { trace, Tracer } from "@opentelemetry/api";
import { DB, GEN_AI, setToolAttrs } from "../../shared/observability/semconv";
import { Tool, ToolResult } from "../../shared/tools/tool.interface";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { VECTOR_STORE, VectorStore } from "../vector-search/vector-store.interface";

@Injectable()
export class KnowledgeBaseStatsTool
  implements Tool<Record<string, never>, { count: number; collection: string }>, OnModuleInit
{
  readonly description = {
    name: "get_knowledge_base_stats",
    description:
      "Get statistics about the organizational knowledge base (number of indexed chunks, collection name). Useful when the user asks how much content is available or whether the knowledge base is populated.",
    parametersJsonSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  };

  private readonly logger = new Logger(KnowledgeBaseStatsTool.name);
  private readonly tracer: Tracer = trace.getTracer("fredy-agent.knowledge-base-stats");

  constructor(
    @Inject(VECTOR_STORE) private readonly store: VectorStore,
    private readonly registry: ToolRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(): Promise<ToolResult<{ count: number; collection: string }>> {
    const span = this.tracer.startSpan("gen_ai.tool.execute");
    span.setAttribute(GEN_AI.TOOL_NAME, this.description.name);
    span.setAttribute(DB.SYSTEM, this.store.providerId);
    span.setAttribute(DB.COLLECTION_NAME, this.store.collectionName);

    try {
      const count = await this.store.count();
      setToolAttrs(span, {
        name: this.description.name,
        success: true,
        output: { count, collection: this.store.collectionName },
      });
      return {
        success: true,
        output: `The knowledge base "${this.store.collectionName}" currently contains ${count} indexed chunks.`,
        data: { count, collection: this.store.collectionName },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`get_knowledge_base_stats failed: ${message}`);
      setToolAttrs(span, { name: this.description.name, success: false });
      span.recordException(error instanceof Error ? error : new Error(message));
      return {
        success: false,
        output: `Failed to retrieve knowledge base stats: ${message}`,
      };
    } finally {
      span.end();
    }
  }
}
