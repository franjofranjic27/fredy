import { BasePromptBuilder } from "./base-prompt-builder";

describe("BasePromptBuilder", () => {
  it("builds a user-only message when no system content", () => {
    const result = new BasePromptBuilder().withUserMessage("hello").build();
    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });

  it("composes system sections with headings", () => {
    const messages = new BasePromptBuilder()
      .withSystem({ heading: "Role", body: "You are Fredy." })
      .withSystem({ body: "Be concise." })
      .withUserMessage("hi")
      .build();
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("## Role");
    expect(messages[0].content).toContain("You are Fredy.");
    expect(messages[0].content).toContain("Be concise.");
  });

  it("appends context as a Context: block", () => {
    const messages = new BasePromptBuilder()
      .withSystem({ body: "Role" })
      .withContext("chunk-1")
      .withContext("chunk-2")
      .withUserMessage("q")
      .build();
    expect(messages[0].content).toContain("Context:");
    expect(messages[0].content).toContain("chunk-1");
    expect(messages[0].content).toContain("chunk-2");
  });

  it("ignores whitespace-only context blocks", () => {
    const messages = new BasePromptBuilder()
      .withSystem({ body: "Role" })
      .withContext("   ")
      .withUserMessage("q")
      .build();
    expect(messages[0].content).not.toContain("Context:");
  });

  it("preserves history but drops embedded system messages", () => {
    const messages = new BasePromptBuilder()
      .withSystem({ body: "Role" })
      .withHistory([
        { role: "system", content: "drop me" },
        { role: "user", content: "old user" },
        { role: "assistant", content: "old reply" },
      ])
      .withUserMessage("new question")
      .build();
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages.find((m) => m.content === "drop me")).toBeUndefined();
  });
});
