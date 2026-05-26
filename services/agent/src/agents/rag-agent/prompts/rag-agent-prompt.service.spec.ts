import { RagAgentPromptService } from "./rag-agent-prompt.service";
import { RAG_SYSTEM_PROMPT } from "./system.prompt";

describe("RagAgentPromptService", () => {
  it("includes the system prompt, context and user message in order", () => {
    const svc = new RagAgentPromptService();
    const messages = svc.build({
      history: [],
      userMessage: "How do I VPN?",
      context: "VPN docs go here.",
    });
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain(RAG_SYSTEM_PROMPT.split("\n")[0]);
    expect(messages[0].content).toContain("Context:");
    expect(messages[0].content).toContain("VPN docs go here.");
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "How do I VPN?",
    });
  });

  it("merges history but drops any pre-existing system messages", () => {
    const svc = new RagAgentPromptService();
    const messages = svc.build({
      history: [
        { role: "system", content: "should be dropped" },
        { role: "user", content: "prior question" },
        { role: "assistant", content: "prior answer" },
      ],
      userMessage: "follow-up",
      context: "ctx",
    });
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages.find((m) => m.content === "should be dropped")).toBeUndefined();
  });

  it("omits the Context block when context is empty", () => {
    const svc = new RagAgentPromptService();
    const messages = svc.build({
      history: [],
      userMessage: "anything",
      context: "",
    });
    expect(messages[0].content).not.toContain("Context:");
  });
});
