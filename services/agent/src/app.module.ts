import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { WinstonModule } from "nest-winston";
import { RagAgentModule } from "./agents/rag-agent/rag-agent.module";
import { AuthModule } from "./auth/auth.module";
import configuration from "./config/configuration";
import { WebModule } from "./entry-points/web/web.module";
import { AgentsModule } from "./shared/agents/agents.module";
import { EmbeddingModule } from "./shared/embedding/embedding.module";
import { LlmModule } from "./shared/llm/llm.module";
import { SessionModule } from "./shared/memory/session/session.module";
import { observabilityLoggerOptions } from "./shared/observability/logger.factory";
import { ObservabilityModule } from "./shared/observability/observability.module";
import { ToolsModule } from "./shared/tools/tools.module";
import { FetchUrlModule } from "./tools/fetch-url/fetch-url.module";
import { KnowledgeBaseStatsModule } from "./tools/knowledge-base-stats/knowledge-base-stats.module";
import { VectorSearchModule } from "./tools/vector-search/vector-search.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    WinstonModule.forRoot(observabilityLoggerOptions),
    ObservabilityModule,
    AgentsModule,
    ToolsModule,
    EmbeddingModule,
    VectorSearchModule,
    KnowledgeBaseStatsModule,
    FetchUrlModule,
    LlmModule,
    SessionModule,
    AuthModule,
    RagAgentModule,
    WebModule,
  ],
})
export class AppModule {}
