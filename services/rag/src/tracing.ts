import { createTracing } from "@fredy/observability/tracing";

export const { initTracing, getTracer, _resetTracing } = createTracing("fredy-rag");
