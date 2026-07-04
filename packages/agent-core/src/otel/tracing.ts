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
 * Initialise OpenTelemetry tracing. MUST be the first import side effect of a
 * service entry point so auto-instrumentation can patch HTTP clients.
 * Idempotent: repeated calls reuse the active SDK.
 */
export function initTracing(serviceName: string): TracingHandle {
  if (activeSdk) {
    return { shutdown };
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

  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown();
  });

  return { shutdown };
}

async function shutdown(): Promise<void> {
  if (!activeSdk) return;
  const sdk = activeSdk;
  activeSdk = null;
  await sdk.shutdown();
}

/** Test hook: forget the active SDK without shutting it down. */
export function _resetTracing(): void {
  activeSdk = null;
}
