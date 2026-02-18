import { toJSONSchema } from "zod";
import type { AnyTool, Tool } from "./types.js";
import type { ToolDefinition } from "../llm/types.js";

export class ToolRegistry {
  private tools = new Map<string, AnyTool>();

  register<TInput, TOutput>(tool: Tool<TInput, TOutput>): this {
    this.tools.set(tool.name, tool as AnyTool);
    return this;
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, args: unknown, timeoutMs = 30_000): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    const parsed = tool.inputSchema.parse(args);
    return Promise.race([
      tool.execute(parsed),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  toDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toJSONSchema(tool.inputSchema) as Record<string, unknown>,
    }));
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
