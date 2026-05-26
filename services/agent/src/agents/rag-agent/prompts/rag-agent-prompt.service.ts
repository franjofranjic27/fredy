import { Injectable } from "@nestjs/common";
import { LlmMessage } from "../../../shared/llm/llm.types";
import { BasePromptBuilder } from "../../../shared/prompts/base-prompt-builder";
import { RAG_SYSTEM_PROMPT } from "./system.prompt";

export interface RagPromptInput {
  history: LlmMessage[];
  userMessage: string;
  context: string;
}

@Injectable()
export class RagAgentPromptService {
  build(input: RagPromptInput): LlmMessage[] {
    return new BasePromptBuilder()
      .withSystem({ body: RAG_SYSTEM_PROMPT })
      .withContext(input.context)
      .withHistory(input.history)
      .withUserMessage(input.userMessage)
      .build();
  }
}
