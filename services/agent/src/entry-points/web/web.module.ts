import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { RagAgentModule } from "../../agents/rag-agent/rag-agent.module";
import { AuthModule } from "../../auth/auth.module";
import { LlmModule } from "../../shared/llm/llm.module";
import { WebController } from "./web.controller";
import { WebService } from "./web.service";

@Module({
  imports: [ConfigModule, AuthModule, LlmModule, RagAgentModule],
  controllers: [WebController],
  providers: [WebService],
})
export class WebModule {}
