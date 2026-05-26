import { ConfigService } from "@nestjs/config";
import { PromptAssemblerService } from "./prompt-assembler.service";
import { RagAgentPromptService } from "./prompts/rag-agent-prompt.service";

function createConfig(budget: number): ConfigService {
  return {
    get: (key: string) => (key === "retrieval.tokenBudget" ? budget : undefined),
  } as unknown as ConfigService;
}

describe("PromptAssemblerService", () => {
  it("builds messages with the trimmed context", () => {
    const svc = new PromptAssemblerService(new RagAgentPromptService(), createConfig(50));
    const messages = svc.buildMessages([], "user q", "context one");
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("context one");
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "user q",
    });
  });

  it("truncates very large context blocks to honour the budget", () => {
    const svc = new PromptAssemblerService(new RagAgentPromptService(), createConfig(10));
    const big = "x".repeat(10_000);
    const messages = svc.buildMessages([], "user q", big);
    expect(messages[0].content).toContain("[truncated]");
    expect(messages[0].content.length).toBeLessThan(big.length);
  });
});
