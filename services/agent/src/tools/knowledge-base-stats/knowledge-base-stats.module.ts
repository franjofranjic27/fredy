import { Module } from "@nestjs/common";
import { ToolsModule } from "../../shared/tools/tools.module";
import { VectorSearchModule } from "../vector-search/vector-search.module";
import { KnowledgeBaseStatsTool } from "./knowledge-base-stats.tool";

@Module({
  imports: [ToolsModule, VectorSearchModule],
  providers: [KnowledgeBaseStatsTool],
  exports: [KnowledgeBaseStatsTool],
})
export class KnowledgeBaseStatsModule {}
