import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { verifyToken, extractRoleFromClaims, type JwtClaims } from "../auth.js";
import { resolveRole } from "../rbac.js";

// ---------------------------------------------------------------------------
// Test key setup — generate an RSA key pair once for all tests
// ---------------------------------------------------------------------------

let privateKey: CryptoKey;
let publicKey: CryptoKey;
const ISSUER = "http://keycloak:8080/realms/fredy";
const AUDIENCE = "fredy-agent";

// We monkey-patch verifyToken to use a local JWKS instead of a remote URL.
// The real verifyToken calls createRemoteJWKSet; for unit tests we swap it
// for a local JWKS built from the generated public key.
import * as authModule from "../auth.js";
import * as jose from "jose";

let localVerify: typeof verifyToken;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  publicKey = keyPair.publicKey;

  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  const localJWKS = createLocalJWKSet({ keys: [jwk] });

  // Wrap verifyToken to use the local JWKS instead of fetching from a URL
  localVerify = async (token: string, _jwksUrl: string, issuer: string, audience: string) => {
    const { payload } = await jose.jwtVerify(token, localJWKS, { issuer, audience });
    return payload as JwtClaims;
  };
});

// ---------------------------------------------------------------------------
// Helper: build a signed JWT
// ---------------------------------------------------------------------------

async function signToken(
  claims: Record<string, unknown>,
  options: { expiresIn?: string; issuer?: string; audience?: string } = {}
): Promise<string> {
  const { expiresIn = "1h", issuer = ISSUER, audience = AUDIENCE } = options;

  const builder = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt();

  if (expiresIn === "-1s") {
    // already expired
    builder.setExpirationTime(Math.floor(Date.now() / 1000) - 1);
  } else {
    builder.setExpirationTime(expiresIn);
  }

  return builder.sign(privateKey);
}

// ---------------------------------------------------------------------------
// verifyToken
// ---------------------------------------------------------------------------

describe("verifyToken", () => {
  it("returns claims for a valid JWT", async () => {
    const token = await signToken({ sub: "user-1", realm_access: { roles: ["user"] } });
    const claims = await localVerify(token, "", ISSUER, AUDIENCE);
    expect(claims.sub).toBe("user-1");
    expect(claims.iss).toBe(ISSUER);
  });

  it("throws for an expired JWT", async () => {
    const token = await signToken({ sub: "user-2" }, { expiresIn: "-1s" });
    await expect(localVerify(token, "", ISSUER, AUDIENCE)).rejects.toThrow();
  });

  it("throws for wrong issuer", async () => {
    const token = await signToken({ sub: "user-3" }, { issuer: "http://wrong-issuer/realms/other" });
    await expect(localVerify(token, "", ISSUER, AUDIENCE)).rejects.toThrow();
  });

  it("throws for wrong audience", async () => {
    const token = await signToken({ sub: "user-4" }, { audience: "wrong-audience" });
    await expect(localVerify(token, "", ISSUER, AUDIENCE)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractRoleFromClaims
// ---------------------------------------------------------------------------

function makeClaims(roles: string[]): JwtClaims {
  return {
    sub: "u",
    iss: ISSUER,
    aud: AUDIENCE,
    exp: 9999999999,
    iat: 0,
    realm_access: { roles },
  };
}

describe("extractRoleFromClaims", () => {
  it("returns 'admin' when admin role is present", () => {
    expect(extractRoleFromClaims(makeClaims(["admin", "user"]))).toBe("admin");
  });

  it("returns 'user' when only user role is present", () => {
    expect(extractRoleFromClaims(makeClaims(["user"]))).toBe("user");
  });

  it("returns null when no recognized role is present", () => {
    expect(extractRoleFromClaims(makeClaims(["other-role"]))).toBeNull();
  });

  it("returns null when realm_access is absent", () => {
    const claims: JwtClaims = { sub: "u", iss: ISSUER, aud: AUDIENCE, exp: 9999999999, iat: 0 };
    expect(extractRoleFromClaims(claims)).toBeNull();
  });

  it("returns null when roles array is empty", () => {
    expect(extractRoleFromClaims(makeClaims([]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveRole with jwtRole parameter
// ---------------------------------------------------------------------------

describe("resolveRole with jwtRole", () => {
  const noHeaders = { get: () => null };

  it("JWT role takes priority over header", () => {
    const headers = { get: (n: string) => (n === "x-openwebui-user-role" ? "user" : null) };
    expect(resolveRole(headers, "admin")).toBe("admin");
  });

  it("JWT role takes priority even when it matches header", () => {
    const headers = { get: (n: string) => (n === "x-openwebui-user-role" ? "admin" : null) };
    expect(resolveRole(headers, "admin")).toBe("admin");
  });

  it("falls back to header when jwtRole is null", () => {
    const headers = { get: (n: string) => (n === "x-openwebui-user-role" ? "admin" : null) };
    expect(resolveRole(headers, null)).toBe("admin");
  });

  it("falls back to header when jwtRole is undefined", () => {
    const headers = { get: (n: string) => (n === "x-openwebui-user-role" ? "admin" : null) };
    expect(resolveRole(headers)).toBe("admin");
  });

  it("falls back to 'user' when jwtRole is null and no header", () => {
    expect(resolveRole(noHeaders, null)).toBe("user");
  });
});
