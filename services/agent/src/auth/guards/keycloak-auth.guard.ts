import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { JwtService } from "../services/jwt.service";

interface AuthedRequest extends Request {
  jwtRole?: string | null;
  user?: unknown;
}

@Injectable()
export class KeycloakAuthGuard implements CanActivate {
  private readonly logger = new Logger(KeycloakAuthGuard.name);
  private readonly jwksUrl: string | undefined;
  private readonly issuer: string | undefined;
  private readonly audience: string;
  private readonly apiKey: string | undefined;

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService,
  ) {
    this.jwksUrl = config.get<string>("auth.keycloak.jwksUrl");
    this.issuer = config.get<string>("auth.keycloak.issuer");
    this.audience = config.get<string>("auth.keycloak.audience") ?? "fredy-agent";
    this.apiKey = config.get<string>("auth.apiKey");
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.path === "/health") return true;

    const authorization = req.header("authorization") ?? "";
    const [scheme, token] = authorization.split(" ");

    if (!this.jwksUrl) {
      // Dev mode: optional static API key check
      if (this.apiKey) {
        if (scheme?.toLowerCase() !== "bearer" || token !== this.apiKey) {
          throw new UnauthorizedException("Invalid API key");
        }
      }
      req.jwtRole = null;
      return true;
    }

    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw new UnauthorizedException("Bearer token required");
    }
    try {
      const claims = await this.jwt.verify(token, this.jwksUrl, this.issuer ?? "", this.audience);
      req.user = claims;
      req.jwtRole = this.jwt.extractRole(claims);
      return true;
    } catch (error) {
      this.logger.debug(`JWT verification failed: ${(error as Error).message}`);
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
