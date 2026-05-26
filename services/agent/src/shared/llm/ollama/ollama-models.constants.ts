import { LlmModelInfo } from "../llm.types";

export const OLLAMA_DEFAULT_MODEL = "llama3.2";

export function buildOllamaModelInfo(id: string): LlmModelInfo {
  return { id, object: "model", owned_by: "ollama" };
}
