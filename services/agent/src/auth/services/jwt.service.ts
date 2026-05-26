import { Injectable, Logger } from "@nestjs/common";
import type { JWTPayload } from "jose";

type JoseModule = typeof import("jose");
type RemoteJWKSet = ReturnType<JoseModule["createRemoteJWKSet"]>;

@Injectable()
export class JwtService {
  private readonly logger = new Logger(JwtService.name);
  private readonly jwksCache = new Map<string, RemoteJWKSet>();
  private jose: JoseModule | null = null;

  private async loadJose(): Promise<JoseModule> {
    if (!this.jose) {
      // jose v6 ships as ESM only, so it must be loaded dynamically from CommonJS.
      this.jose = await import("jose");
    }
    return this.jose;
  }

  async verify(
    token: string,
    jwksUrl: string,
    issuer: string,
    audience: string,
  ): Promise<JWTPayload> {
    const jose = await this.loadJose();
    const jwks = await this.getJwks(jwksUrl);
    const { payload } = await jose.jwtVerify(token, jwks, { issuer, audience });
    return payload;
  }

  extractRole(claims: JWTPayload): string | null {
    const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
    if (realmAccess?.roles && realmAccess.roles.length > 0) {
      return realmAccess.roles[0];
    }
    if (typeof claims.role === "string") {
      return claims.role;
    }
    return null;
  }

  private async getJwks(url: string): Promise<RemoteJWKSet> {
    const cached = this.jwksCache.get(url);
    if (cached) return cached;
    const jose = await this.loadJose();
    const set = jose.createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 5 * 60 * 1000,
    });
    this.jwksCache.set(url, set);
    return set;
  }
}
