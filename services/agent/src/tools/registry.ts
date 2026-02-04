import { zodToJsonSchema } from "zod-to-json-schema";
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

  async execute(name: string, args: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    const parsed = tool.inputSchema.parse(args);
    return tool.execute(parsed);
  }

  toDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: zodToJsonSchema(tool.inputSchema as any) as Record<string, unknown>,
    }));
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
