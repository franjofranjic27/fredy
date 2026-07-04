import type { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Central registry for LangChain tools. Agents look tools up by name and RBAC
 * filters against the registered names.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, StructuredToolInterface>();

  register(tool: StructuredToolInterface): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): StructuredToolInterface | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): StructuredToolInterface[] {
    return [...this.tools.values()];
  }

  listNames(): string[] {
    return [...this.tools.keys()];
  }
}
