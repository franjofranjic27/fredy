import { z } from "zod";
import type { Tool } from "./types.js";

/**
 * Example tool: Fetch content from a URL
 */
export const fetchUrlTool: Tool<
  { url: string },
  { status: number; body: string }
> = {
  name: "fetch_url",
  description: "Fetches content from a URL and returns the response body",
  inputSchema: z.object({
    url: z.url().describe("The URL to fetch"),
  }),
  async execute({ url }) {
    const response = await fetch(url);
    const body = await response.text();
    return {
      status: response.status,
      body: body.slice(0, 2000), // Truncate for safety
    };
  },
};

/**
 * Example tool: Get current date and time
 */
export const getCurrentTimeTool: Tool<
  { timezone?: string },
  { datetime: string; timezone: string }
> = {
  name: "get_current_time",
  description: "Returns the current date and time",
  inputSchema: z.object({
    timezone: z
      .string()
      .optional()
      .default("UTC")
      .describe("Timezone (e.g., 'UTC', 'Europe/Berlin')"),
  }),
  async execute({ timezone = "UTC" }) {
    const now = new Date();
    return {
      datetime: now.toLocaleString("en-US", { timeZone: timezone }),
      timezone,
    };
  },
};

/**
 * Example tool: Simple calculator
 */
export const calculatorTool: Tool<
  { expression: string },
  { result: number | string }
> = {
  name: "calculator",
  description:
    "Evaluates a mathematical expression. Supports +, -, *, /, and parentheses.",
  inputSchema: z.object({
    expression: z
      .string()
      .describe("Mathematical expression to evaluate (e.g., '2 + 2 * 3')"),
  }),
  async execute({ expression }) {
    // Simple safe evaluation - only allow numbers and basic operators
    const sanitized = expression.replaceAll(/[^0-9+\-*/().s]/g, "");
    if (sanitized !== expression.replaceAll(/\s/g, "")) {
      return { result: "Error: Invalid characters in expression" };
    }
    try {
      // Using Function instead of eval for slightly better isolation
      const result = new Function(`return (${sanitized})`)() as number;
      return { result };
    } catch {
      return { result: "Error: Could not evaluate expression" };
    }
  },
};
