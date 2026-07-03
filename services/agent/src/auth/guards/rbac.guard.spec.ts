import { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { RbacService } from "../services/rbac.service";
import { RbacGuard } from "./rbac.guard";

function createContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function createConfig(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function makeRequest(headers: Record<string, string>, jwtRole: string | null) {
  return {
    header: (name: string) => headers[name.toLowerCase()] ?? null,
    jwtRole,
  };
}

describe("RbacGuard", () => {
  let registry: ToolRegistryService;
  beforeEach(() => {
    registry = new ToolRegistryService();
    registry.register({
      name: "vector_search",
      description: "vs",
      inputSchema: z.object({}),
      execute: jest.fn(),
    });
    registry.register({
      name: "fetch_url",
      description: "fu",
      inputSchema: z.object({}),
      execute: jest.fn(),
    });
  });

  it("populates allowedToolNames with all tools when no config", () => {
    const guard = new RbacGuard(createConfig({}), new RbacService(), registry);
    guard.onModuleInit();
    const req = makeRequest({}, null);
    const allowed = guard.canActivate(createContext(req));
    expect(allowed).toBe(true);
    expect((req as Record<string, unknown>).allowedToolNames).toEqual([
      "vector_search",
      "fetch_url",
    ]);
    expect((req as Record<string, unknown>).resolvedRole).toBe("default");
  });

  it("filters tools based on the JWT role when Keycloak is enabled", () => {
    const guard = new RbacGuard(
      createConfig({
        "auth.keycloak.jwksUrl": "https://keycloak/example/certs",
        "auth.roleToolConfig": '{"user":["fetch_url"]}',
      }),
      new RbacService(),
      registry,
    );
    guard.onModuleInit();
    const req = makeRequest({}, "user");
    guard.canActivate(createContext(req));
    expect((req as Record<string, unknown>).allowedToolNames).toEqual(["fetch_url"]);
  });

  it("crashes early when ROLE_TOOL_CONFIG is malformed", () => {
    const guard = new RbacGuard(
      createConfig({ "auth.roleToolConfig": "{not json}" }),
      new RbacService(),
      registry,
    );
    expect(() => guard.onModuleInit()).toThrow(/not valid JSON/);
  });
});
