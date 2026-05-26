// Side-effect-only import. Must be the FIRST import in any process entry point
// (main.ts, cli.ts, mcp.bootstrap.ts) so OpenTelemetry's NodeSDK can patch
// http/express/etc. before they are required by Nest.
import { initTracing } from "./shared/observability/tracing.bootstrap";

initTracing(process.env.SERVICE_NAME ?? "fredy-agent");
