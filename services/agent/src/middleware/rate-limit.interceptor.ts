import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Observable } from "rxjs";
import { Request, Response } from "express";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(config: ConfigService) {
    const rpm = config.get<number>("rateLimit.rpm") ?? 60;
    this.capacity = config.get<number>("rateLimit.burst") ?? 10;
    this.refillPerMs = rpm / 60_000;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = this.identify(req);
    const bucket = this.consumeToken(key);
    if (!bucket.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(bucket.retryAfterMs / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      throw new HttpException(
        {
          error: {
            message: "Rate limit exceeded",
            code: "RATE_LIMITED",
            retry_after_ms: bucket.retryAfterMs,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return next.handle();
  }

  private identify(req: Request): string {
    const forwarded = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
    return forwarded || req.ip || req.socket.remoteAddress || "unknown";
  }

  private consumeToken(key: string): {
    allowed: boolean;
    retryAfterMs: number;
  } {
    const now = Date.now();
    const existing = this.buckets.get(key);
    const bucket: Bucket = existing ?? { tokens: this.capacity, lastRefill: now };
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
      bucket.lastRefill = now;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      return { allowed: true, retryAfterMs: 0 };
    }
    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit / this.refillPerMs);
    this.buckets.set(key, bucket);
    return { allowed: false, retryAfterMs };
  }
}
