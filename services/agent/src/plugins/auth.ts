import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Logger } from "@fredy/agent-core";

export interface AuthenticatedRequest extends FastifyRequest {
  jwtRole?: string | null;
  user?: JWTPayload;
}

export type TokenVerifier = (token: string) => Promise<JWTPayload>;

export interface AuthHookOptions {
  readonly apiKey?: string;
  readonly jwksUrl?: string;
  readonly issuer?: string;
  readonly audience: string;
  readonly logger: Logger;
  /** Test seam; defaults to jose-based JWKS verification. */
  readonly verifyToken?: TokenVerifier;
}

export function extractRole(claims: JWTPayload): string | null {
  const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
  if (realmAccess?.roles && realmAccess.roles.length > 0) {
    return realmAccess.roles[0];
  }
  if (typeof claims.role === "string") {
    return claims.role;
  }
  return null;
}

function createJoseVerifier(jwksUrl: string, issuer: string, audience: string): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(jwksUrl), { cacheMaxAge: 5 * 60 * 1000 });
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
      algorithms: ["RS256"], // Keycloak default; reject alg=none and symmetric tokens.
    });
    return payload;
  };
}

/** Constant-time API-key comparison; length is checked first to avoid throwing. */
function apiKeyMatches(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Never let jose fall back to an empty issuer (which disables the issuer check).
 * loadConfig already enforces this at boot; this is defence-in-depth.
 */
function requireIssuer(issuer: string | undefined): string {
  if (!issuer) {
    throw new Error("KEYCLOAK_ISSUER is required when Keycloak JWT verification is enabled");
  }
  return issuer;
}

function unauthorized(reply: FastifyReply, message: string): void {
  void reply.code(401).send({ statusCode: 401, message, error: "Unauthorized" });
}

/**
 * onRequest hook replicating the previous KeycloakAuthGuard:
 * /health bypasses auth entirely; without KEYCLOAK_JWKS_URL an optional static
 * API key is enforced; with Keycloak configured a bearer JWT is verified
 * against the remote JWKS (issuer + audience) and the role claim extracted.
 */
export function createAuthHook(options: AuthHookOptions): onRequestAsyncHookHandler {
  const verifyToken =
    options.verifyToken ??
    (options.jwksUrl
      ? createJoseVerifier(options.jwksUrl, requireIssuer(options.issuer), options.audience)
      : undefined);
  const keycloakEnabled = Boolean(options.jwksUrl);

  return async (request, reply) => {
    const path = request.url.split("?")[0];
    if (path === "/health") return;

    const authorization = request.headers.authorization ?? "";
    const [scheme, token] = authorization.split(" ");
    const authedRequest = request as AuthenticatedRequest;

    if (!keycloakEnabled) {
      // Dev mode: optional static API key check
      if (options.apiKey) {
        if (scheme?.toLowerCase() !== "bearer" || !token || !apiKeyMatches(token, options.apiKey)) {
          unauthorized(reply, "Invalid API key");
          return;
        }
      }
      authedRequest.jwtRole = null;
      return;
    }

    if (scheme?.toLowerCase() !== "bearer" || !token) {
      unauthorized(reply, "Bearer token required");
      return;
    }
    try {
      const claims = await verifyToken!(token);
      authedRequest.user = claims;
      authedRequest.jwtRole = extractRole(claims);
    } catch (error) {
      options.logger.debug(
        { err: error },
        `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      unauthorized(reply, "Invalid or expired token");
    }
  };
}
