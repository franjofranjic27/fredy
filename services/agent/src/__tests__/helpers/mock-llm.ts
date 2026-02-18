import type { LLMClient, LLMResponse, Message, ToolDefinition } from "../../llm/types.js";

export function createMockLLMClient(
  responses: LLMResponse[],
  captured?: Message[][]
): LLMClient {
  let callCount = 0;
  return {
    async chat(messages: Message[], _tools?: ToolDefinition[]): Promise<LLMResponse> {
      captured?.push([...messages]);
      const response = responses[callCount];
      if (!response) {
        throw new Error(`No mock response for call #${callCount}`);
      }
      callCount++;
      return response;
    },
  };
}
