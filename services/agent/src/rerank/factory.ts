import type { AppConfig } from "../config.js";
import { createCohereReranker } from "./cohere.js";
import { createVoyageReranker } from "./voyage.js";
import type { Reranker } from "./reranker.js";

/** Builds the configured reranker, or null when RERANKER=none. */
export function createReranker(
  config: AppConfig["rerank"],
  fetchImpl?: typeof fetch,
): Reranker | null {
  if (config.provider === "none") return null;
  if (!config.apiKey) {
    throw new Error(`RERANK_API_KEY is required when RERANKER is "${config.provider}"`);
  }
  if (!config.model) {
    throw new Error(`RERANK_MODEL could not be resolved for provider "${config.provider}"`);
  }
  const options = { apiKey: config.apiKey, model: config.model, fetchImpl };
  return config.provider === "cohere"
    ? createCohereReranker(options)
    : createVoyageReranker(options);
}
