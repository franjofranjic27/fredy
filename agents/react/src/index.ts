import { runAgent } from "./agent.js";
import { createAgentConfig } from "./setup.js";

async function main() {
  const config = createAgentConfig();

  console.log("Fredy Agent initialized");
  console.log(`Available tools: ${config.tools.list().join(", ")}`);
  console.log("");

  const userMessage = process.argv[2] ?? "What information is available in the knowledge base?";

  console.log(`User: ${userMessage}`);
  console.log("");

  try {
    const result = await runAgent(config, [{ role: "user" as const, content: userMessage }]);

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

await main();
