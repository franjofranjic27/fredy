import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LlmClient } from "./llm-client.interface";
import { LlmError, LlmModelInfo } from "./llm.types";
import { LLM_CLIENTS } from "./llm.tokens";

@Injectable()
export class LlmRegistryService {
  private readonly logger = new Logger(LlmRegistryService.name);

  constructor(
    @Inject(LLM_CLIENTS) private readonly clients: LlmClient[],
    private readonly config: ConfigService,
  ) {}

  private get fallbackModel(): string {
    return this.config.get<string>("llm.fallbackModel") ?? "claude-sonnet-4-5-20250929";
  }

  resolveClient(modelId?: string): LlmClient {
    const resolved = modelId ?? this.fallbackModel;
    const match = this.clients.find((c) => c.supportsModel(resolved));
    if (match) return match;

    this.logger.warn(
      `No client supports model "${resolved}"; falling back to "${this.fallbackModel}"`,
    );
    const fallback = this.clients.find((c) => c.supportsModel(this.fallbackModel));
    if (fallback) return fallback;

    if (this.clients.length === 0) {
      throw new LlmError("MODEL_NOT_FOUND", "No LLM clients registered in LLM_CLIENTS");
    }
    return this.clients[0];
  }

  async listAllModels(): Promise<LlmModelInfo[]> {
    const lists = await Promise.all(this.clients.map((c) => c.listModels()));
    return lists.flat();
  }
}
