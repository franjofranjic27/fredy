import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LlmMessage } from "../../shared/llm/llm.types";
import { RagAgentPromptService } from "./prompts/rag-agent-prompt.service";
import { trimToTokenBudget } from "./token-utils";

@Injectable()
export class PromptAssemblerService {
  private readonly contextBudget: number;

  constructor(
    private readonly prompt: RagAgentPromptService,
    config: ConfigService,
  ) {
    this.contextBudget = config.get<number>("retrieval.tokenBudget") ?? 3200;
  }

  buildMessages(history: LlmMessage[], userMessage: string, context: string): LlmMessage[] {
    const trimmedContext = trimToTokenBudget(context, this.contextBudget);
    return this.prompt.build({
      history,
      userMessage,
      context: trimmedContext,
    });
  }
}
