import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "../services/jwt.service";
import { KeycloakAuthGuard } from "./keycloak-auth.guard";

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

function makeRequest(
  authHeader: string | undefined,
  path = "/v1/chat/completions",
): Record<string, unknown> {
  return {
    path,
    header: (name: string) => (name.toLowerCase() === "authorization" ? (authHeader ?? "") : ""),
  };
}

describe("KeycloakAuthGuard", () => {
  it("allows /health without authentication", async () => {
    const guard = new KeycloakAuthGuard(
      createConfig({ "auth.apiKey": "secret" }),
      new JwtService(),
    );
    const req = makeRequest(undefined, "/health");
    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
  });

  it("dev mode without API key always passes and sets jwtRole=null", async () => {
    const guard = new KeycloakAuthGuard(createConfig({}), new JwtService());
    const req = makeRequest(undefined);
    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
    expect((req as Record<string, unknown>).jwtRole).toBeNull();
  });

  it("dev mode rejects wrong API key", async () => {
    const guard = new KeycloakAuthGuard(
      createConfig({ "auth.apiKey": "secret" }),
      new JwtService(),
    );
    const req = makeRequest("Bearer wrong");
    await expect(guard.canActivate(createContext(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("dev mode accepts the correct API key", async () => {
    const guard = new KeycloakAuthGuard(
      createConfig({ "auth.apiKey": "secret" }),
      new JwtService(),
    );
    const req = makeRequest("Bearer secret");
    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
  });

  it("Keycloak mode rejects missing bearer", async () => {
    const guard = new KeycloakAuthGuard(
      createConfig({
        "auth.keycloak.jwksUrl": "https://kc/example/certs",
        "auth.keycloak.issuer": "https://kc/realms/fredy",
      }),
      new JwtService(),
    );
    const req = makeRequest(undefined);
    await expect(guard.canActivate(createContext(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("Keycloak mode delegates to JwtService and stores role", async () => {
    const jwt = {
      verify: jest.fn().mockResolvedValue({ sub: "user-1" }),
      extractRole: jest.fn().mockReturnValue("admin"),
    } as unknown as JwtService;
    const guard = new KeycloakAuthGuard(
      createConfig({
        "auth.keycloak.jwksUrl": "https://kc/example/certs",
        "auth.keycloak.issuer": "https://kc/realms/fredy",
      }),
      jwt,
    );
    const req = makeRequest("Bearer token");
    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
    expect((req as Record<string, unknown>).jwtRole).toBe("admin");
  });

  it("Keycloak mode rejects invalid tokens", async () => {
    const jwt = {
      verify: jest.fn().mockRejectedValue(new Error("bad signature")),
    } as unknown as JwtService;
    const guard = new KeycloakAuthGuard(
      createConfig({
        "auth.keycloak.jwksUrl": "https://kc/example/certs",
        "auth.keycloak.issuer": "https://kc/realms/fredy",
      }),
      jwt,
    );
    const req = makeRequest("Bearer expired");
    await expect(guard.canActivate(createContext(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
