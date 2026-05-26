import { LlmModelInfo } from "../llm.types";

export const GEMINI_MODELS: LlmModelInfo[] = [
  { id: "gemini-2.5-pro", object: "model", owned_by: "google" },
  { id: "gemini-2.5-flash", object: "model", owned_by: "google" },
  { id: "gemini-2.0-flash", object: "model", owned_by: "google" },
];

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

export function isGeminiModel(modelId: string): boolean {
  if (GEMINI_MODELS.some((m) => m.id === modelId)) return true;
  return modelId.startsWith("gemini-");
}
