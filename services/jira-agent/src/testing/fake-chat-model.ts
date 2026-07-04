import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export interface FakeChatModelFields extends BaseChatModelParams {
  response?: string;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  modelName?: string;
  failWith?: Error;
}

/**
 * Deterministic in-memory chat model for the compose nodes: fixed response,
 * usage metadata and prompt capture. (Streaming is not needed here — the
 * jira-agent never streams to a client.)
 */
export class FakeChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  readonly response: string;
  readonly usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  readonly modelName: string;
  readonly failWith?: Error;
  /** Message lists this model was invoked with, in call order. */
  readonly receivedMessages: BaseMessage[][] = [];

  constructor(fields: FakeChatModelFields = {}) {
    super(fields);
    this.response = fields.response ?? "fake response";
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
}
