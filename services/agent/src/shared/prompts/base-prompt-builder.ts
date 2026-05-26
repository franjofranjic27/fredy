import { LlmMessage } from "../llm/llm.types";

export interface PromptSection {
  heading?: string;
  body: string;
}

/**
 * Lightweight prompt builder. Composes a system prompt plus optional context sections
 * and a chat history into the LlmMessage[] shape that providers expect.
 */
export class BasePromptBuilder {
  private systemSections: PromptSection[] = [];
  private contextBlocks: string[] = [];
  private history: LlmMessage[] = [];

  withSystem(section: PromptSection): this {
    this.systemSections.push(section);
    return this;
  }

  withContext(block: string): this {
    if (block.trim().length > 0) this.contextBlocks.push(block);
    return this;
  }

  withHistory(messages: LlmMessage[]): this {
    this.history.push(...messages.filter((m) => m.role !== "system"));
    return this;
  }

  withUserMessage(content: string): this {
    this.history.push({ role: "user", content });
    return this;
  }

  build(): LlmMessage[] {
    const systemContent = this.systemSections
      .map((s) => (s.heading ? `## ${s.heading}\n${s.body}` : s.body))
      .join("\n\n");
    const contextContent = this.contextBlocks.join("\n\n---\n\n");
    const messages: LlmMessage[] = [];
    const combinedSystem = [systemContent, contextContent ? `Context:\n${contextContent}` : ""]
      .filter(Boolean)
      .join("\n\n");
    if (combinedSystem) {
      messages.push({ role: "system", content: combinedSystem });
    }
    messages.push(...this.history);
    return messages;
  }
}
