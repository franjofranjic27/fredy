import type { FastifyInstance } from "fastify";

export interface PollerStatus {
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
  readonly queueDepth: number;
}

export function registerHealthRoute(app: FastifyInstance, getStatus: () => PollerStatus): void {
  app.get("/health", async () => ({ status: "ok", poller: getStatus() }));
}
