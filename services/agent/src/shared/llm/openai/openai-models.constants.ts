import { LlmModelInfo } from "../llm.types";

export const OPENAI_MODELS: LlmModelInfo[] = [
  { id: "gpt-4o", object: "model", owned_by: "openai" },
  { id: "gpt-4o-mini", object: "model", owned_by: "openai" },
  { id: "gpt-4.1", object: "model", owned_by: "openai" },
  { id: "gpt-4.1-mini", object: "model", owned_by: "openai" },
  { id: "o1", object: "model", owned_by: "openai" },
  { id: "o3-mini", object: "model", owned_by: "openai" },
];

export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

export function isOpenAIModel(modelId: string): boolean {
  if (OPENAI_MODELS.some((m) => m.id === modelId)) return true;
  return (
    modelId.startsWith("gpt-") ||
    modelId.startsWith("o1") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4")
  );
}
