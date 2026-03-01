import { trace, type Tracer } from "@opentelemetry/api";

export function createTracing(serviceName: string) {
  let activeSdk: { start(): void; shutdown?(): Promise<void> } | undefined;
  let sdkStarted = false;

  /**
   * Initialises the OpenTelemetry SDK.
   * No-op unless OTEL_ENABLED=true.
   */
  async function initTracing(): Promise<void> {
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

    activeSdk = new NodeSDK({
      serviceName,
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    activeSdk.start();
    sdkStarted = true;
  }

  /**
   * Returns a tracer for this service.
   * When no SDK is registered all spans are no-ops.
   */
  function getTracer(): Tracer {
    return trace.getTracer(serviceName);
  }

  /**
   * Reset internal state (for tests only).
   * Shuts down the active SDK instance before resetting to prevent duplicate
   * spans or resource leaks when tests call initTracing() more than once.
   */
  function _resetTracing(): void {
    void activeSdk?.shutdown?.();
    activeSdk = undefined;
    sdkStarted = false;
  }

  return { initTracing, getTracer, _resetTracing };
}
