import { Injectable, Logger } from "@nestjs/common";
import { Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { hostname } from "node:os";
import { AgentLogEvent } from "./events/agent-log-event.type";

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);
  private readonly host = hostname();
  private readonly tracer = trace.getTracer("fredy-agent");

  log(event: AgentLogEvent): void {
    const enriched = {
      timestamp: new Date().toISOString(),
      service: process.env.SERVICE_NAME ?? "fredy-agent",
      env: process.env.PROJECT_ENV ?? "development",
      host: this.host,
      ...event,
    };
    this.logger.log(JSON.stringify(enriched));
  }

  startSpan(name: string, requestId?: string, parentName?: string): Span {
    const fullName = parentName ? `${parentName}.${name}` : name;
    const spanName = requestId ? `${fullName}:${requestId}` : fullName;
    const span = this.tracer.startSpan(spanName);
    if (requestId) span.setAttribute("request.id", requestId);
    return span;
  }

  endSpanOk(span: Span): void {
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  endSpanError(span: Span, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    span.recordException(error instanceof Error ? error : new Error(message));
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    span.end();
  }
}
