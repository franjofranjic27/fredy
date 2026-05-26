import { Injectable, Logger } from "@nestjs/common";
import { Agent } from "./agent.interface";

@Injectable()
export class AgentRegistryService {
  private readonly logger = new Logger(AgentRegistryService.name);
  private readonly agents = new Map<string, Agent>();

  register(agent: Agent): void {
    const id = agent.descriptor.id;
    if (this.agents.has(id)) {
      throw new Error(`Agent "${id}" is already registered`);
    }
    this.agents.set(id, agent);
    this.logger.log(`Agent registered: ${id}`);
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  listIds(): string[] {
    return Array.from(this.agents.keys());
  }
}
