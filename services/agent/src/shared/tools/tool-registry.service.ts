import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { ToolDefinition, ToolDescription } from "./tool.interface";

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    const name = tool.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }
    this.tools.set(name, tool);
    this.logger.log(`Tool registered: ${name}`);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getDescriptions(): ToolDescription[] {
    return this.getAllTools().map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: this.toJsonSchema(t),
    }));
  }

  getJsonSchema(name: string): Record<string, unknown> | undefined {
    const tool = this.tools.get(name);
    return tool ? this.toJsonSchema(tool) : undefined;
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  get size(): number {
    return this.tools.size;
  }

  private toJsonSchema(tool: ToolDefinition): Record<string, unknown> {
    return z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
  }
}
