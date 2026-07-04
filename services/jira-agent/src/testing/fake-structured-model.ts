import type { BaseMessage } from "@langchain/core/messages";
import type { InvokeStructured } from "../agent/llm.js";

export interface QueuedInvokeStructured {
  readonly invokeStructured: InvokeStructured;
  /** Message lists per structured call, in call order. */
  readonly receivedMessages: BaseMessage[][];
}

/**
 * Fake for the invokeStructured seam: returns the queued parsed objects in
 * order and records the prompts. Throws when the queue runs dry so a test
 * never silently reuses a response.
 */
export function createQueuedInvokeStructured(
  responses: readonly unknown[],
): QueuedInvokeStructured {
  const queue = [...responses];
  const receivedMessages: BaseMessage[][] = [];
  const invokeStructured: InvokeStructured = async <T>(
    _schema: unknown,
    messages: BaseMessage[],
  ): Promise<T> => {
    receivedMessages.push(messages);
    if (queue.length === 0) {
      throw new Error("FakeStructured queue exhausted — test queued too few responses");
    }
    return queue.shift() as T;
  };
  return { invokeStructured, receivedMessages };
}
