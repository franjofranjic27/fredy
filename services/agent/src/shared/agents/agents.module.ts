import { Global, Module } from "@nestjs/common";
import { AgentRegistryService } from "./agent-registry.service";

@Global()
@Module({
  providers: [AgentRegistryService],
  exports: [AgentRegistryService],
})
export class AgentsModule {}
