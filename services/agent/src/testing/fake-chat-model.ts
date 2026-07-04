import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";

export interface FakeChatModelFields extends BaseChatModelParams {
  response?: string;
  chunks?: string[];
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  modelName?: string;
  failWith?: Error;
}

/**
 * Deterministic in-memory chat model for tests: fixed response, optional
 * token streaming, usage metadata and prompt capture.
 */
export class FakeChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  readonly response: string;
  readonly chunks: string[];
  readonly usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  readonly modelName: string;
  readonly failWith?: Error;
  /** Message lists this model was invoked with, in call order. */
  readonly receivedMessages: BaseMessage[][] = [];

  constructor(fields: FakeChatModelFields = {}) {
    super(fields);
    this.response = fields.response ?? "fake response";
    this.chunks = fields.chunks ?? [this.response];
    this.usage = fields.usage;
    this.modelName = fields.modelName ?? "fake-model";
    this.failWith = fields.failWith;
  }

  _llmType(): string {
    return "fake";
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    if (this.failWith) throw this.failWith;
    this.receivedMessages.push(messages);
    const message = new AIMessage({
      content: this.response,
      usage_metadata: this.usage,
      response_metadata: { model: this.modelName },
    });
    return {
      generations: [{ text: this.response, message, generationInfo: { finish_reason: "stop" } }],
      llmOutput: {},
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    if (this.failWith) throw this.failWith;
    this.receivedMessages.push(messages);
    for (const text of this.chunks) {
      const chunk = new ChatGenerationChunk({
        text,
        message: new AIMessageChunk({ content: text }),
      });
      yield chunk;
      await runManager?.handleLLMNewToken(text);
    }
  }
}
