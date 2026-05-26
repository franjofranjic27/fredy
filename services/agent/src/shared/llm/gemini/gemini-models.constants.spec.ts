import { GEMINI_DEFAULT_MODEL, GEMINI_MODELS, isGeminiModel } from "./gemini-models.constants";

describe("gemini-models.constants", () => {
  it("default model is included in catalog", () => {
    expect(GEMINI_MODELS.map((m) => m.id)).toContain(GEMINI_DEFAULT_MODEL);
  });

  it("matches gemini- prefix", () => {
    expect(isGeminiModel("gemini-3-pro")).toBe(true);
  });

  it("rejects other prefixes", () => {
    expect(isGeminiModel("gpt-4o")).toBe(false);
  });
});
