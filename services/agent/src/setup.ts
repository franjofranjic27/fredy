import { createClaudeClient, createOllamaClient } from "./llm/index.js";
import {
  ToolRegistry,
  fetchUrlTool,
  getCurrentTimeTool,
  calculatorTool,
  createKnowledgeBaseTool,
} from "./tools/index.js";
import type { AgentConfig } from "./agent.js";
import { createLogger } from "./logger.js";

export const SYSTEM_PROMPT = `You are Fredy, an IT Operations assistant.

Your role is to help users with:
- Finding information in the knowledge base (Confluence documentation)
- Troubleshooting technical issues
- Checking system status
- Running diagnostics

Guidelines:
- When users ask about procedures, documentation, or how to do something, search the knowledge base first
- Use the available tools to gather information before answering
- Be concise and accurate in your responses
- If you don't know something, say so rather than guessing
- When reporting tool results, summarize the key findings
- Always cite the source URL when using information from the knowledge base

Available tools will be provided to you. Use them when appropriate to answer user questions.`;

export function createAgentConfig(
  overrides: { verbose?: boolean } = {}
): AgentConfig {
  const llmProvider = process.env.LLM_PROVIDER ?? "claude";

  let llm: AgentConfig["llm"];

  if (llmProvider === "ollama") {
    llm = createOllamaClient({
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      model: process.env.OLLAMA_MODEL ?? "llama3.2",
    });
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required"
      );
    }
    llm = createClaudeClient({ apiKey });
  }

  const tools = new ToolRegistry()
    .register(fetchUrlTool)
    .register(getCurrentTimeTool)
    .register(calculatorTool);

  const embeddingApiKey = process.env.EMBEDDING_API_KEY;
  if (embeddingApiKey) {
    const kbTool = createKnowledgeBaseTool({
      qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",
      collectionName: process.env.QDRANT_COLLECTION ?? "confluence-pages",
      embeddingApiKey,
      embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
      embeddingProvider: (process.env.EMBEDDING_PROVIDER ?? "openai") as
        | "openai"
        | "voyage",
    });
    tools.register(kbTool);
  }

  const verbose = overrides.verbose ?? process.env.VERBOSE === "true";

  return {
    llm,
    tools,
    systemPrompt: SYSTEM_PROMPT,
    verbose,
    logger: createLogger({ level: verbose ? "debug" : "info" }),
  };
}
