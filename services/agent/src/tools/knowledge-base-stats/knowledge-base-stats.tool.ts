import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import type { AttributeValue } from "@opentelemetry/api";
import { DB } from "../../shared/observability/semconv";
import { ToolContext, ToolDefinition, ToolResult } from "../../shared/tools/tool.interface";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { VECTOR_STORE, VectorStore } from "../vector-search/vector-store.interface";
import {
  knowledgeBaseStatsInputSchema,
  KnowledgeBaseStatsInput,
} from "./knowledge-base-stats.schema";

@Injectable()
export class KnowledgeBaseStatsTool
  implements
    ToolDefinition<KnowledgeBaseStatsInput, { count: number; collection: string }>,
    OnModuleInit
{
  readonly name = "get_knowledge_base_stats";
  readonly description =
    "Get statistics about the organizational knowledge base (number of indexed chunks, collection name). Useful when the user asks how much content is available or whether the knowledge base is populated.";
  readonly inputSchema = knowledgeBaseStatsInputSchema;
  readonly staticAttributes: Record<string, AttributeValue>;

  constructor(
    @Inject(VECTOR_STORE) private readonly store: VectorStore,
    private readonly registry: ToolRegistryService,
  ) {
    this.staticAttributes = {
      [DB.SYSTEM]: store.providerId,
      [DB.COLLECTION_NAME]: store.collectionName,
    };
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    _input: KnowledgeBaseStatsInput,
    _ctx: ToolContext,
  ): Promise<ToolResult<{ count: number; collection: string }>> {
    const count = await this.store.count();
    return {
      output: `The knowledge base "${this.store.collectionName}" currently contains ${count} indexed chunks.`,
      data: { count, collection: this.store.collectionName },
    };
  }
}
