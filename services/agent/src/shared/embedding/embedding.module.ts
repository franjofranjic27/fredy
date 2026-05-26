import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EMBEDDING_CLIENT } from "./embedding-client.interface";
import { OpenAIEmbeddingService } from "./openai/openai-embedding.service";
import { VoyageEmbeddingService } from "./voyage/voyage-embedding.service";

@Module({
  imports: [ConfigModule],
  providers: [
    OpenAIEmbeddingService,
    VoyageEmbeddingService,
    {
      provide: EMBEDDING_CLIENT,
      useFactory: (
        config: ConfigService,
        openai: OpenAIEmbeddingService,
        voyage: VoyageEmbeddingService,
      ) => {
        const provider = config.get<string>("embedding.provider") ?? "openai";
        return provider === "voyage" ? voyage : openai;
      },
      inject: [ConfigService, OpenAIEmbeddingService, VoyageEmbeddingService],
    },
  ],
  exports: [EMBEDDING_CLIENT],
})
export class EmbeddingModule {}
