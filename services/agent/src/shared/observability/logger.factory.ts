import { WinstonModuleOptions, utilities as nestWinstonUtils } from "nest-winston";
import * as winston from "winston";

export function buildLoggerOptions(): WinstonModuleOptions {
  const level = process.env.LOG_LEVEL ?? "info";
  const isProduction = process.env.NODE_ENV === "production";

  const format = isProduction
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      )
    : winston.format.combine(
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.ms(),
        nestWinstonUtils.format.nestLike("fredy-agent", {
          colors: true,
          prettyPrint: true,
        }),
      );

  return {
    level,
    format,
    transports: [new winston.transports.Console()],
  };
}

export const observabilityLoggerOptions = buildLoggerOptions();
