import { trace, type Tracer } from "@opentelemetry/api";

const SERVICE_NAME = "fredy-agent";

let sdkStarted = false;

/**
 * Initialises the OpenTelemetry SDK.
 * No-op unless OTEL_ENABLED=true.
 */
export async function initTracing(): Promise<void> {
  if (process.env.OTEL_ENABLED !== "true") return;
  if (sdkStarted) return;

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = await import(
    "@opentelemetry/auto-instrumentations-node"
  );
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-http"
  );

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

  const sdk = new NodeSDK({
    serviceName: SERVICE_NAME,
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  sdkStarted = true;
}

/**
 * Returns a tracer for this service.
 * When no SDK is registered all spans are no-ops.
 */
export function getTracer(): Tracer {
  return trace.getTracer(SERVICE_NAME);
}

/** Reset internal state (for tests only). */
export function _resetTracing(): void {
  sdkStarted = false;
}
