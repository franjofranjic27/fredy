import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EmbeddingModule } from "../../shared/embedding/embedding.module";
import { ToolsModule } from "../../shared/tools/tools.module";
import { QdrantService } from "./qdrant/qdrant.service";
import { VectorSearchTool } from "./vector-search.tool";
import { VECTOR_STORE } from "./vector-store.interface";

@Module({
  imports: [ConfigModule, EmbeddingModule, ToolsModule],
  providers: [
    QdrantService,
    { provide: VECTOR_STORE, useExisting: QdrantService },
    VectorSearchTool,
  ],
  exports: [VECTOR_STORE, VectorSearchTool],
})
export class VectorSearchModule {}
