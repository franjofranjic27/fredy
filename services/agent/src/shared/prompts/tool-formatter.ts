import { ToolDescription } from "../tools/tool.interface";

/**
 * Renders tool descriptions as a human-readable block for system prompts.
 * Used when an agent exposes available tools to the LLM in plain text rather
 * than via the provider's native tool-calling API.
 */
export function formatToolsForPrompt(descriptions: ToolDescription[]): string {
  if (descriptions.length === 0) return "";
  const blocks = descriptions.map((d) => {
    return [
      `Tool: ${d.name}`,
      `Description: ${d.description}`,
      `Parameters: ${JSON.stringify(d.parametersJsonSchema)}`,
    ].join("\n");
  });
  return ["Available tools:", "", blocks.join("\n\n")].join("\n");
}
