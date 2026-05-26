import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmbeddingClient, EmbeddingProviderId } from "../embedding-client.interface";
import { LlmError } from "../../llm/llm.types";

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

@Injectable()
export class VoyageEmbeddingService implements EmbeddingClient {
  readonly providerId: EmbeddingProviderId = "voyage";
  readonly model: string;
  private readonly logger = new Logger(VoyageEmbeddingService.name);
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>("embedding.voyage.apiKey");
    this.model = config.get<string>("embedding.voyage.model") ?? "voyage-3-lite";
    this.endpoint =
      config.get<string>("embedding.voyage.endpoint") ?? "https://api.voyageai.com/v1/embeddings";
  }

  async embedQuery(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new LlmError(
        "UNAUTHORIZED",
        "Voyage embedding key not configured (EMBEDDING_VOYAGE_API_KEY missing)",
      );
    }
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        input_type: "query",
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Voyage embedding failed (${response.status}): ${body}`);
      throw new LlmError(
        response.status === 429 ? "RATE_LIMITED" : "API_ERROR",
        `Voyage embedding failed: ${response.status}`,
      );
    }
    const payload = (await response.json()) as VoyageEmbeddingResponse;
    return payload.data[0].embedding;
  }
}
