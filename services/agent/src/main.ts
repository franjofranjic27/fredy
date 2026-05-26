import "reflect-metadata";
import "./tracing-init";

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { WinstonModule } from "nest-winston";
import { AppModule } from "./app.module";
import { observabilityLoggerOptions } from "./shared/observability/logger.factory";

async function bootstrap(): Promise<void> {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: WinstonModule.createLogger(observabilityLoggerOptions),
  });
  app.enableShutdownHooks();
  app.set("trust proxy", true);

  const config = app.get(ConfigService);
  const port = config.get<number>("port") ?? 8001;
  await app.listen(port, "0.0.0.0");
  logger.log(`Fredy Agent listening on http://0.0.0.0:${port}`);
}

bootstrap().catch((error) => {
  console.error("Bootstrap failed", error);
  process.exit(1);
});
