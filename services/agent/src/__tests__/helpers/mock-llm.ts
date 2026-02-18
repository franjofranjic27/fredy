import type { LLMClient, LLMResponse, Message, ToolDefinition } from "../../llm/types.js";

export function createMockLLMClient(
  responses: LLMResponse[],
  captured?: Message[][]
): LLMClient {
  let callCount = 0;
  return {
    async chat(
      messages: Message[],
      _tools?: ToolDefinition[],
      onDelta?: (delta: string) => Promise<void> | void,
    ): Promise<LLMResponse> {
      captured?.push([...messages]);
      const response = responses[callCount];
      if (!response) {
        throw new Error(`No mock response for call #${callCount}`);
      }
      callCount++;
      // Simulate streaming: emit the full content as a single delta
      if (onDelta && response.content) {
        await onDelta(response.content);
      }
      return response;
    },
  };
}
