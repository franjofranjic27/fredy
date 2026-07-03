import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AnthropicClientService } from "./anthropic/anthropic-client.service";
import { GeminiClientService } from "./gemini/gemini-client.service";
import { LLM_CLIENTS } from "./llm.tokens";
import { LlmRegistryService } from "./llm-registry.service";
import { OpenAIClientService } from "./openai/openai-client.service";

@Module({
  imports: [ConfigModule],
  providers: [
    AnthropicClientService,
    OpenAIClientService,
    GeminiClientService,
    LlmRegistryService,
    {
      provide: LLM_CLIENTS,
      useFactory: (
        anthropic: AnthropicClientService,
        openai: OpenAIClientService,
        gemini: GeminiClientService,
      ) => [anthropic, openai, gemini],
      inject: [AnthropicClientService, OpenAIClientService, GeminiClientService],
    },
  ],
  exports: [LlmRegistryService, LLM_CLIENTS],
})
export class LlmModule {}
