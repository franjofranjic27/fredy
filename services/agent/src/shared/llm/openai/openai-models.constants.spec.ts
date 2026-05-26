import { OPENAI_DEFAULT_MODEL, OPENAI_MODELS, isOpenAIModel } from "./openai-models.constants";

describe("openai-models.constants", () => {
  it("default model is included in catalog", () => {
    expect(OPENAI_MODELS.map((m) => m.id)).toContain(OPENAI_DEFAULT_MODEL);
  });

  it("matches gpt-* and o-series prefixes", () => {
    expect(isOpenAIModel("gpt-4o")).toBe(true);
    expect(isOpenAIModel("o1-preview")).toBe(true);
    expect(isOpenAIModel("o3-mini")).toBe(true);
  });

  it("rejects unrelated model IDs", () => {
    expect(isOpenAIModel("claude-sonnet-4-5")).toBe(false);
    expect(isOpenAIModel("llama3.2")).toBe(false);
  });
});
