import type { AgentDefinition, AgentRun } from "./agent.js";

export interface RegisteredAgent {
  readonly id: string;
  readonly ownedBy: string;
  readonly run: AgentRun;
}

const DEFAULT_OWNER = "fredy";

/**
 * Registry of instantiated agents. `/v1/models` lists its entries and
 * `/v1/chat/completions` dispatches on the requested model id.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, RegisteredAgent>();

  register<TDeps>(definition: AgentDefinition<TDeps>, deps: TDeps): void {
    if (this.agents.has(definition.id)) {
      throw new Error(`Agent "${definition.id}" is already registered`);
    }
    this.agents.set(definition.id, {
      id: definition.id,
      ownedBy: definition.ownedBy ?? DEFAULT_OWNER,
      run: definition.createRun(deps),
    });
  }

  get(id: string): RegisteredAgent | undefined {
    return this.agents.get(id);
  }

  list(): RegisteredAgent[] {
    return [...this.agents.values()];
  }

  listIds(): string[] {
    return [...this.agents.keys()];
  }
}
