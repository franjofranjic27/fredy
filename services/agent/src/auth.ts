import { createRemoteJWKSet, jwtVerify } from "jose";

export interface JwtClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  realm_access?: { roles: string[] };
  [key: string]: unknown;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
  jwks ??= createRemoteJWKSet(new URL(jwksUrl));
  return jwks;
}

export async function verifyToken(
  token: string,
  jwksUrl: string,
  issuer: string,
  audience: string
): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, getJwks(jwksUrl), {
    issuer,
    audience,
  });
  return payload as JwtClaims;
}

export function extractRoleFromClaims(claims: JwtClaims): string | null {
  return claims.realm_access?.roles?.find((r) => r === "admin" || r === "user") ?? null;
}
