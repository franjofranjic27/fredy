import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AnthropicClientService } from "./anthropic/anthropic-client.service";
import { GeminiClientService } from "./gemini/gemini-client.service";
import { LLM_CLIENTS } from "./llm.tokens";
import { LlmRegistryService } from "./llm-registry.service";
import { OllamaClientService } from "./ollama/ollama-client.service";
import { OpenAIClientService } from "./openai/openai-client.service";

@Module({
  imports: [ConfigModule],
  providers: [
    AnthropicClientService,
    OpenAIClientService,
    GeminiClientService,
    OllamaClientService,
    LlmRegistryService,
    {
      provide: LLM_CLIENTS,
      useFactory: (
        anthropic: AnthropicClientService,
        openai: OpenAIClientService,
        gemini: GeminiClientService,
        ollama: OllamaClientService,
      ) => [anthropic, openai, gemini, ollama],
      inject: [
        AnthropicClientService,
        OpenAIClientService,
        GeminiClientService,
        OllamaClientService,
      ],
    },
  ],
  exports: [LlmRegistryService, LLM_CLIENTS],
})
export class LlmModule {}
