import { CallHandler, ExecutionContext, HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { of } from "rxjs";
import { RateLimitInterceptor } from "./rate-limit.interceptor";

function createConfig(rpm: number, burst: number): ConfigService {
  return {
    get: (key: string) =>
      key === "rateLimit.rpm" ? rpm : key === "rateLimit.burst" ? burst : undefined,
  } as unknown as ConfigService;
}

function createContext(ip: string): {
  context: ExecutionContext;
  setHeader: jest.Mock;
} {
  const setHeader = jest.fn();
  const req = {
    ip,
    headers: {},
    socket: { remoteAddress: ip },
  };
  const res = { setHeader };
  const context = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

const next: CallHandler = { handle: () => of("ok") };

describe("RateLimitInterceptor", () => {
  it("passes the first request through and consumes a token", () => {
    const interceptor = new RateLimitInterceptor(createConfig(60, 5));
    const { context } = createContext("1.1.1.1");
    expect(() => interceptor.intercept(context, next)).not.toThrow();
  });

  it("blocks the (burst+1)th request from the same IP", () => {
    const interceptor = new RateLimitInterceptor(createConfig(60, 3));
    const { context, setHeader } = createContext("2.2.2.2");
    for (let i = 0; i < 3; i++) interceptor.intercept(context, next);
    expect(() => interceptor.intercept(context, next)).toThrow(HttpException);
    expect(setHeader).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });

  it("tracks IPs independently", () => {
    const interceptor = new RateLimitInterceptor(createConfig(60, 1));
    const a = createContext("3.3.3.3");
    const b = createContext("4.4.4.4");
    interceptor.intercept(a.context, next);
    expect(() => interceptor.intercept(b.context, next)).not.toThrow();
    expect(() => interceptor.intercept(a.context, next)).toThrow(HttpException);
  });

  it("preserves the x-forwarded-for chain head as the identity", () => {
    const interceptor = new RateLimitInterceptor(createConfig(60, 1));
    const req = {
      ip: "127.0.0.1",
      headers: { "x-forwarded-for": "10.0.0.5, 10.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    };
    const res = { setHeader: jest.fn() };
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
        getNext: () => ({}),
      }),
    } as unknown as ExecutionContext;
    interceptor.intercept(context, next);
    expect(() => interceptor.intercept(context, next)).toThrow(HttpException);
  });

  it("refills the bucket over time", async () => {
    const interceptor = new RateLimitInterceptor(createConfig(6000, 1));
    const { context } = createContext("5.5.5.5");
    interceptor.intercept(context, next);
    expect(() => interceptor.intercept(context, next)).toThrow(HttpException);
    await new Promise((r) => setTimeout(r, 50));
    expect(() => interceptor.intercept(context, next)).not.toThrow();
  });
});
