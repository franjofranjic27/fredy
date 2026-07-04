import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { RoleToolConfig } from "@fredy/agent-core";
import { createRbacHook, resolveRole, type RbacRequest } from "./rbac.js";
import { createTestLogger } from "../testing/test-logger.js";

const headers = (record: Record<string, string>) => ({
  get: (name: string) => record[name.toLowerCase()] ?? null,
});

describe("resolveRole", () => {
  it("derives the role exclusively from the JWT when Keycloak is enabled", () => {
    expect(resolveRole(headers({}), "user", true)).toBe("user");
  });

  it("ignores a spoofed X-Role header when Keycloak is enabled (no privilege escalation)", () => {
    // The verified JWT role must win — a client-supplied header cannot escalate.
    expect(resolveRole(headers({ "x-role": "admin" }), "user", true)).toBe("user");
    expect(resolveRole(headers({ "x-openwebui-user-role": "admin" }), "user", true)).toBe("user");
  });

  it("falls back to default with Keycloak on and no JWT role, ignoring headers", () => {
    expect(resolveRole(headers({ "x-role": "admin" }), null, true)).toBe("default");
  });

  it("falls back to default when no signals", () => {
    expect(resolveRole(headers({}), null, true)).toBe("default");
    expect(resolveRole(headers({}), null, false)).toBe("default");
  });

  it("ignores the JWT role when Keycloak is disabled", () => {
    expect(resolveRole(headers({}), "should-ignore", false)).toBe("default");
  });

  it("honours the X-Role header only in the dev/no-keycloak path", () => {
    expect(resolveRole(headers({ "x-role": "admin" }), null, false)).toBe("admin");
  });

  it("ignores whitespace-only header values in the dev path", () => {
    expect(resolveRole(headers({ "x-role": "   " }), null, false)).toBe("default");
  });

  it("accepts OpenWebUI's forwarded x-openwebui-user-role header in the dev path", () => {
    expect(resolveRole(headers({ "x-openwebui-user-role": "admin" }), null, false)).toBe("admin");
  });

  it("prefers x-role over x-openwebui-user-role in the dev path", () => {
    expect(
      resolveRole(headers({ "x-role": "admin", "x-openwebui-user-role": "user" }), null, false),
    ).toBe("admin");
  });
});

describe("rbac hook", () => {
  async function buildApp(
    roleToolConfig: RoleToolConfig,
    keycloakEnabled = false,
    jwtRole?: string,
  ) {
    const app = Fastify();
    let captured: { resolvedRole?: string; allowedToolNames?: string[] } = {};
    if (jwtRole !== undefined) {
      app.addHook("onRequest", async (request) => {
        (request as RbacRequest).jwtRole = jwtRole;
      });
    }
    app.post(
      "/x",
      {
        preHandler: [
          createRbacHook({
            keycloakEnabled,
            roleToolConfig,
            listToolNames: () => ["vector_search", "fetch_url"],
            logger: createTestLogger().logger,
          }),
        ],
      },
      async (request) => {
        const rbacRequest = request as RbacRequest;
        captured = {
          resolvedRole: rbacRequest.resolvedRole,
          allowedToolNames: rbacRequest.allowedToolNames,
        };
        return { ok: true };
      },
    );
    await app.ready();
    return { app, getCaptured: () => captured };
  }

  it("attaches the resolved role and the full tool list with empty config", async () => {
    const { app, getCaptured } = await buildApp(new Map());
    await app.inject({ method: "POST", url: "/x", payload: {} });
    expect(getCaptured()).toEqual({
      resolvedRole: "default",
      allowedToolNames: ["vector_search", "fetch_url"],
    });
  });

  it("filters tools by the role from the x-role header", async () => {
    const config: RoleToolConfig = new Map([["user", new Set(["vector_search"])]]);
    const { app, getCaptured } = await buildApp(config);
    await app.inject({
      method: "POST",
      url: "/x",
      payload: {},
      headers: { "x-role": "user" },
    });
    expect(getCaptured()).toEqual({
      resolvedRole: "user",
      allowedToolNames: ["vector_search"],
    });
  });

  it("denies all tools for unknown roles without a default entry", async () => {
    const config: RoleToolConfig = new Map([["admin", new Set(["vector_search"])]]);
    const { app, getCaptured } = await buildApp(config);
    await app.inject({
      method: "POST",
      url: "/x",
      payload: {},
      headers: { "x-role": "stranger" },
    });
    expect(getCaptured().allowedToolNames).toEqual([]);
  });

  it("with Keycloak on, a spoofed x-role header does not change the resolved JWT role", async () => {
    const config: RoleToolConfig = new Map([
      ["user", new Set(["vector_search"])],
      ["admin", new Set(["vector_search", "fetch_url"])],
    ]);
    const { app, getCaptured } = await buildApp(config, true, "user");
    await app.inject({
      method: "POST",
      url: "/x",
      payload: {},
      headers: { "x-role": "admin" },
    });
    // Stays on the JWT role "user" — the header is ignored under Keycloak.
    expect(getCaptured()).toEqual({
      resolvedRole: "user",
      allowedToolNames: ["vector_search"],
    });
  });

  it("with Keycloak off, the x-role header override still works (dev path)", async () => {
    const config: RoleToolConfig = new Map([["admin", new Set(["vector_search", "fetch_url"])]]);
    const { app, getCaptured } = await buildApp(config, false);
    await app.inject({
      method: "POST",
      url: "/x",
      payload: {},
      headers: { "x-role": "admin" },
    });
    expect(getCaptured()).toEqual({
      resolvedRole: "admin",
      allowedToolNames: ["vector_search", "fetch_url"],
    });
  });
});
