import type { FastifyInstance } from "fastify";
import type { AgentRegistry } from "@fredy/agent-core";

export interface ModelListEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export function registerModelsRoute(app: FastifyInstance, agents: AgentRegistry): void {
  app.get("/v1/models", async () => {
    const created = Math.floor(Date.now() / 1000);
    return {
      object: "list" as const,
      data: agents.list().map(
        (agent): ModelListEntry => ({
          id: agent.id,
          object: "model",
          created,
          owned_by: agent.ownedBy,
        }),
      ),
    };
  });
}
