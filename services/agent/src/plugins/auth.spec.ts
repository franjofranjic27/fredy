import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createAuthHook, extractRole, type AuthHookOptions } from "./auth.js";
import type { AuthenticatedRequest } from "./auth.js";
import { createTestLogger } from "../testing/test-logger.js";

async function buildApp(options: Partial<AuthHookOptions>) {
  const app = Fastify();
  let captured: { jwtRole?: string | null; user?: unknown } = {};
  app.addHook(
    "onRequest",
    createAuthHook({
      audience: "fredy-agent",
      logger: createTestLogger().logger,
      ...options,
    }),
  );
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/protected", async (request) => {
    const authed = request as AuthenticatedRequest;
    captured = { jwtRole: authed.jwtRole, user: authed.user };
    return { ok: true };
  });
  await app.ready();
  return { app, getCaptured: () => captured };
}

describe("auth hook — open mode (no keycloak, no api key)", () => {
  it("lets requests pass and sets jwtRole=null", async () => {
    const { app, getCaptured } = await buildApp({});
    const response = await app.inject({ method: "GET", url: "/protected" });
    expect(response.statusCode).toBe(200);
    expect(getCaptured().jwtRole).toBeNull();
  });
});

describe("auth hook — API key mode", () => {
  it("accepts the correct bearer API key", async () => {
    const { app } = await buildApp({ apiKey: "secret" });
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer secret" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("rejects a wrong API key with 401 Invalid API key", async () => {
    const { app } = await buildApp({ apiKey: "secret" });
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer wrong" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      statusCode: 401,
      message: "Invalid API key",
      error: "Unauthorized",
    });
  });

  it("rejects an API key that only shares a prefix (constant-time compare)", async () => {
    const { app } = await buildApp({ apiKey: "secret" });
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer secret-extra" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a missing authorization header", async () => {
    const { app } = await buildApp({ apiKey: "secret" });
    const response = await app.inject({ method: "GET", url: "/protected" });
    expect(response.statusCode).toBe(401);
  });

  it("still bypasses auth for /health", async () => {
    const { app } = await buildApp({ apiKey: "secret" });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });
});

describe("auth hook — Keycloak mode", () => {
  const keycloak = { jwksUrl: "https://kc/certs", issuer: "https://kc/realms/fredy" };

  it("rejects a missing bearer token with 401 Bearer token required", async () => {
    const { app } = await buildApp({ ...keycloak, verifyToken: async () => ({}) });
    const response = await app.inject({ method: "GET", url: "/protected" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      statusCode: 401,
      message: "Bearer token required",
      error: "Unauthorized",
    });
  });

  it("verifies the token and stores claims plus extracted role", async () => {
    const { app, getCaptured } = await buildApp({
      ...keycloak,
      verifyToken: async () => ({ sub: "user-1", realm_access: { roles: ["admin"] } }),
    });
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer token" },
    });
    expect(response.statusCode).toBe(200);
    expect(getCaptured().jwtRole).toBe("admin");
    expect(getCaptured().user).toMatchObject({ sub: "user-1" });
  });

  it("rejects invalid tokens with 401 Invalid or expired token", async () => {
    const { app } = await buildApp({
      ...keycloak,
      verifyToken: async () => {
        throw new Error("bad signature");
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer expired" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      statusCode: 401,
      message: "Invalid or expired token",
      error: "Unauthorized",
    });
  });

  it("bypasses /health even in Keycloak mode", async () => {
    const { app } = await buildApp({
      ...keycloak,
      verifyToken: async () => {
        throw new Error("must not be called");
      },
    });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });

  it("refuses to build a JWKS verifier without an issuer (never skips issuer check)", () => {
    expect(() =>
      createAuthHook({
        jwksUrl: "https://kc/certs",
        audience: "fredy-agent",
        logger: createTestLogger().logger,
      }),
    ).toThrow(/KEYCLOAK_ISSUER is required/);
  });
});

describe("extractRole", () => {
  it("prefers the first realm_access role", () => {
    expect(extractRole({ realm_access: { roles: ["admin", "user"] } })).toBe("admin");
  });

  it("falls back to the role claim", () => {
    expect(extractRole({ role: "user" })).toBe("user");
  });

  it("returns null when no role information exists", () => {
    expect(extractRole({})).toBeNull();
    expect(extractRole({ realm_access: { roles: [] } })).toBeNull();
  });
});
