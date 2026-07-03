import { Global, Module } from "@nestjs/common";
import { ToolExecutorService } from "./tool-executor.service";
import { ToolRegistryService } from "./tool-registry.service";

@Global()
@Module({
  providers: [ToolRegistryService, ToolExecutorService],
  exports: [ToolRegistryService, ToolExecutorService],
})
export class ToolsModule {}
