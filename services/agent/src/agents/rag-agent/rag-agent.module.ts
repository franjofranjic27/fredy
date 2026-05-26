import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LlmModule } from "../../shared/llm/llm.module";
import { SessionModule } from "../../shared/memory/session/session.module";
import { ToolsModule } from "../../shared/tools/tools.module";
import { VectorSearchModule } from "../../tools/vector-search/vector-search.module";
import { PromptAssemblerService } from "./prompt-assembler.service";
import { QueryRewriteService } from "./query-rewrite.service";
import { RagAgentService } from "./rag-agent.service";
import { ResponseRecorderService } from "./response-recorder.service";
import { RetrievalService } from "./retrieval.service";
import { RagAgentPromptService } from "./prompts/rag-agent-prompt.service";

@Module({
  imports: [ConfigModule, LlmModule, SessionModule, ToolsModule, VectorSearchModule],
  providers: [
    RagAgentService,
    RagAgentPromptService,
    QueryRewriteService,
    RetrievalService,
    PromptAssemblerService,
    ResponseRecorderService,
  ],
  exports: [RagAgentService],
})
export class RagAgentModule {}
