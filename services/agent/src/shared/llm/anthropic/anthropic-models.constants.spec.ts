import {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MODELS,
  isAnthropicModel,
} from "./anthropic-models.constants";

describe("anthropic-models.constants", () => {
  it("default model is included in catalog", () => {
    expect(ANTHROPIC_MODELS.map((m) => m.id)).toContain(ANTHROPIC_DEFAULT_MODEL);
  });

  it("isAnthropicModel matches known IDs", () => {
    for (const m of ANTHROPIC_MODELS) {
      expect(isAnthropicModel(m.id)).toBe(true);
    }
  });

  it("isAnthropicModel matches the claude- prefix", () => {
    expect(isAnthropicModel("claude-future-99")).toBe(true);
  });

  it("isAnthropicModel rejects unknown IDs", () => {
    expect(isAnthropicModel("gpt-4o")).toBe(false);
    expect(isAnthropicModel("gemini-2.5-pro")).toBe(false);
  });
});
