import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@fredy/agent-core";
import { FakeChatModel } from "../../testing/fake-chat-model.js";
import { createTestLogger } from "../../testing/test-logger.js";
import { hasPriorTurns, rewriteQuery } from "./query-rewrite.js";

const HISTORY: ChatMessage[] = [
  { role: "user", content: "How do I set up VPN access?" },
  { role: "assistant", content: "Install Cisco AnyConnect and ..." },
  { role: "user", content: "and on cluster B?" },
];

function deps(model: FakeChatModel) {
  return { createModel: () => model, logger: createTestLogger().logger };
}

describe("hasPriorTurns", () => {
  it("is false for a single user message (with or without system prompt)", () => {
    expect(hasPriorTurns([{ role: "user", content: "hi" }])).toBe(false);
    expect(
      hasPriorTurns([
        { role: "system", content: "client prompt" },
        { role: "user", content: "hi" },
      ]),
    ).toBe(false);
  });

  it("is true once the conversation has earlier turns", () => {
    expect(hasPriorTurns(HISTORY)).toBe(true);
  });
});

describe("rewriteQuery", () => {
  it("returns the original message untouched when there is no history", async () => {
    const model = new FakeChatModel({ response: "should not be used" });
    const result = await rewriteQuery(
      "How do I set up VPN?",
      [{ role: "user", content: "How do I set up VPN?" }],
      deps(model),
    );
    expect(result).toBe("How do I set up VPN?");
    expect(model.receivedMessages).toHaveLength(0);
  });

  it("condenses a follow-up into the model's standalone query", async () => {
    const model = new FakeChatModel({ response: "  VPN setup on cluster B  " });
    const result = await rewriteQuery("and on cluster B?", HISTORY, deps(model));
    expect(result).toBe("VPN setup on cluster B");
    // The rewrite prompt must contain the conversation and the latest message.
    const prompt = model.receivedMessages[0].map((message) => String(message.content)).join("\n");
    expect(prompt).toContain("How do I set up VPN access?");
    expect(prompt).toContain("and on cluster B?");
  });

  it("falls back to the original message when the model call fails", async () => {
    const model = new FakeChatModel({ failWith: new Error("provider down") });
    const logger = createTestLogger().logger;
    const warn = vi.spyOn(logger, "warn");
    const result = await rewriteQuery("and on cluster B?", HISTORY, {
      createModel: () => model,
      logger,
    });
    expect(result).toBe("and on cluster B?");
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to the original message when the model returns an empty string", async () => {
    const model = new FakeChatModel({ response: "   " });
    const result = await rewriteQuery("and on cluster B?", HISTORY, deps(model));
    expect(result).toBe("and on cluster B?");
  });
});
