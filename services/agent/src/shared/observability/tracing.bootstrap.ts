import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const ATTR_SERVICE_NAME = "service.name";
const ATTR_SERVICE_VERSION = "service.version";
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = "deployment.environment.name";

export interface TracingHandle {
  shutdown: () => Promise<void>;
}

let activeSdk: NodeSDK | null = null;

/**
 * Initialise OpenTelemetry tracing.
 * MUST be called before NestFactory.create() so auto-instrumentation can patch HTTP clients.
 */
export function initTracing(serviceName: string): TracingHandle {
  if (activeSdk) {
    return { shutdown: () => activeSdk!.shutdown() };
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: process.env.SERVICE_VERSION ?? "0.1.0",
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.PROJECT_ENV ?? "development",
  });

  const traceExporter = endpoint
    ? new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` })
    : undefined;

  activeSdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  activeSdk.start();

  const shutdown = async () => {
    if (!activeSdk) return;
    await activeSdk.shutdown();
    activeSdk = null;
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });

  return { shutdown };
}

export function _resetTracing(): void {
  activeSdk = null;
}
