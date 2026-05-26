import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmbeddingClient, EmbeddingProviderId } from "../embedding-client.interface";
import { LlmError } from "../../llm/llm.types";

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

@Injectable()
export class OpenAIEmbeddingService implements EmbeddingClient {
  readonly providerId: EmbeddingProviderId = "openai";
  readonly model: string;
  private readonly logger = new Logger(OpenAIEmbeddingService.name);
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>("embedding.openai.apiKey");
    this.model = config.get<string>("embedding.openai.model") ?? "text-embedding-3-small";
    this.endpoint =
      config.get<string>("embedding.openai.endpoint") ?? "https://api.openai.com/v1/embeddings";
  }

  async embedQuery(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new LlmError(
        "UNAUTHORIZED",
        "OpenAI embedding key not configured (EMBEDDING_OPENAI_API_KEY missing)",
      );
    }
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`OpenAI embedding failed (${response.status}): ${body}`);
      throw new LlmError(
        response.status === 429 ? "RATE_LIMITED" : "API_ERROR",
        `OpenAI embedding failed: ${response.status}`,
      );
    }
    const payload = (await response.json()) as OpenAIEmbeddingResponse;
    return payload.data[0].embedding;
  }
}
