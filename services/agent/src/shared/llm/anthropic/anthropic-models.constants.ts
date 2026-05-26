import { LlmModelInfo } from "../llm.types";

export const ANTHROPIC_MODELS: LlmModelInfo[] = [
  { id: "claude-opus-4-1", object: "model", owned_by: "anthropic" },
  { id: "claude-sonnet-4-5-20250929", object: "model", owned_by: "anthropic" },
  { id: "claude-haiku-4-5-20251001", object: "model", owned_by: "anthropic" },
];

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export function isAnthropicModel(modelId: string): boolean {
  if (ANTHROPIC_MODELS.some((m) => m.id === modelId)) return true;
  return modelId.startsWith("claude-");
}
