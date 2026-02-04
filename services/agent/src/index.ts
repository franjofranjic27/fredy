import { createClaudeClient } from "./llm/index.js";
import {
  ToolRegistry,
  fetchUrlTool,
  getCurrentTimeTool,
  calculatorTool,
} from "./tools/index.js";
import { runAgent } from "./agent.js";

const SYSTEM_PROMPT = `You are Fredy, an IT Operations assistant.

Your role is to help users with:
- Finding information in the knowledge base
- Troubleshooting technical issues
- Checking system status
- Running diagnostics

Guidelines:
- Use the available tools to gather information before answering
- Be concise and accurate in your responses
- If you don't know something, say so rather than guessing
- When reporting tool results, summarize the key findings

Available tools will be provided to you. Use them when appropriate to answer user questions.`;

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    console.error("Set it with: export ANTHROPIC_API_KEY=your-key-here");
    process.exit(1);
  }

  // Initialize LLM client
  const llm = createClaudeClient({ apiKey });

  // Initialize tool registry with example tools
  const tools = new ToolRegistry()
    .register(fetchUrlTool)
    .register(getCurrentTimeTool)
    .register(calculatorTool);

  console.log("Fredy Agent initialized");
  console.log(`Available tools: ${tools.list().join(", ")}`);
  console.log("");

  // Get user input from command line args or use default
  const userMessage =
    process.argv[2] ?? "What time is it and what is 42 * 17?";

  console.log(`User: ${userMessage}`);
  console.log("");

  try {
    const result = await runAgent(
      {
        llm,
        tools,
        systemPrompt: SYSTEM_PROMPT,
        verbose: process.env.VERBOSE === "true",
      },
      userMessage
    );

    console.log("=== Agent Response ===");
    console.log(result.response);
    console.log("");
    console.log(`Tools used: ${result.toolsUsed.map((t) => t.name).join(", ") || "none"}`);
    console.log(`Iterations: ${result.iterations}`);
  } catch (error) {
    console.error("Agent error:", error);
    process.exit(1);
  }
}

main();
