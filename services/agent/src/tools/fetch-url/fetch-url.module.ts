import { Module } from "@nestjs/common";
import { ToolsModule } from "../../shared/tools/tools.module";
import { FetchUrlTool } from "./fetch-url.tool";

@Module({
  imports: [ToolsModule],
  providers: [FetchUrlTool],
  exports: [FetchUrlTool],
})
export class FetchUrlModule {}
