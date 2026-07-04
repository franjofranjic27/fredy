import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { contentToString, type ChatMessage, type Logger } from "@fredy/agent-core";

const REWRITE_SYSTEM_PROMPT = `You condense a conversation into a single standalone search query for a documentation knowledge base.

Rules:
- Resolve pronouns and references ("it", "that server", "the second cluster") using the conversation.
- Keep the query in the language of the latest user message.
- Preserve exact identifiers verbatim (hostnames, error codes, product names).
- Output ONLY the query text — no quotes, no explanation.`;

const MAX_HISTORY_MESSAGES = 8;
const MAX_REWRITE_TOKENS = 200;

export interface QueryRewriteDeps {
  readonly createModel: (options: { temperature?: number; maxTokens?: number }) => BaseChatModel;
  readonly logger: Logger;
}

/** True when the conversation has turns before the latest user message. */
export function hasPriorTurns(messages: readonly ChatMessage[]): boolean {
  const nonSystem = messages.filter((message) => message.role !== "system");
  return nonSystem.length > 1;
}

/**
 * Rewrites the latest user message into a standalone retrieval query using
 * the conversation history, so follow-up questions ("and on cluster B?")
 * retrieve against their full meaning instead of the bare fragment.
 * Any failure falls back to the original message — retrieval must never
 * break because of the rewrite step.
 */
export async function rewriteQuery(
  userMessage: string,
  messages: readonly ChatMessage[],
  deps: QueryRewriteDeps,
  config?: RunnableConfig,
): Promise<string> {
  if (!hasPriorTurns(messages)) return userMessage;

  const history = messages
    .filter((message) => message.role !== "system")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  try {
    const model = deps.createModel({ temperature: 0, maxTokens: MAX_REWRITE_TOKENS });
    const response = await model.invoke(
      [
        new SystemMessage(REWRITE_SYSTEM_PROMPT),
        new HumanMessage(
          `Conversation:\n${history}\n\nLatest user message:\n${userMessage}\n\nStandalone search query:`,
        ),
      ],
      config,
    );
    const rewritten = contentToString(response.content).trim();
    return rewritten.length > 0 ? rewritten : userMessage;
  } catch (error) {
    deps.logger.warn(
      { err: error },
      `Query rewrite failed (${error instanceof Error ? error.message : String(error)}) — using original message`,
    );
    return userMessage;
  }
}
