import { Injectable, Logger } from "@nestjs/common";
import { Tool, ToolDescription } from "./tool.interface";

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool<any, any>): void {
    const name = tool.description.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }
    this.tools.set(name, tool);
    this.logger.log(`Tool registered: ${name}`);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getDescriptions(): ToolDescription[] {
    return this.getAllTools().map((t) => t.description);
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  get size(): number {
    return this.tools.size;
  }
}
