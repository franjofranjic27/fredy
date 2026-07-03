import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EmbeddingModule } from "../../shared/embedding/embedding.module";
import { ToolsModule } from "../../shared/tools/tools.module";
import { PgVectorService } from "./pgvector/pgvector.service";
import { VectorSearchTool } from "./vector-search.tool";
import { VECTOR_STORE } from "./vector-store.interface";

@Module({
  imports: [ConfigModule, EmbeddingModule, ToolsModule],
  providers: [
    PgVectorService,
    { provide: VECTOR_STORE, useExisting: PgVectorService },
    VectorSearchTool,
  ],
  exports: [VECTOR_STORE, VectorSearchTool],
})
export class VectorSearchModule {}
