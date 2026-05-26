import "reflect-metadata";
import "./tracing-init";

import { NestFactory } from "@nestjs/core";
import { RagAgentService } from "./agents/rag-agent/rag-agent.service";
import { AppModule } from "./app.module";

async function main(): Promise<void> {
  const userMessage = process.argv[2] ?? "What information is available in the knowledge base?";

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });

  try {
    const agent = app.get(RagAgentService);
    const sessionId = `cli-${Date.now()}`;
    console.log(`User: ${userMessage}\n`);
    const result = await agent.processMessage({ sessionId, userMessage });
    console.log(`Fredy (${result.model}):\n${result.content}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error("CLI failed", error);
  process.exit(1);
});
