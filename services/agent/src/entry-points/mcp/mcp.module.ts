import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EmbeddingModule } from "../../shared/embedding/embedding.module";
import { ObservabilityModule } from "../../shared/observability/observability.module";
import { ToolsModule } from "../../shared/tools/tools.module";
import { FetchUrlModule } from "../../tools/fetch-url/fetch-url.module";
import { KnowledgeBaseStatsModule } from "../../tools/knowledge-base-stats/knowledge-base-stats.module";
import { VectorSearchModule } from "../../tools/vector-search/vector-search.module";
import { McpService } from "./mcp.service";

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    ToolsModule,
    EmbeddingModule,
    VectorSearchModule,
    KnowledgeBaseStatsModule,
    FetchUrlModule,
  ],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
