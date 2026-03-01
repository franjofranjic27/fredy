import { createTracing } from "@fredy/common/tracing";

export const { initTracing, getTracer, _resetTracing } = createTracing("fredy-agent");
