import { CanActivate, ExecutionContext, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { ToolRegistryService } from "../../shared/tools/tool-registry.service";
import { RbacService, RoleToolConfig } from "../services/rbac.service";

interface RbacRequest extends Request {
  jwtRole?: string | null;
  allowedToolNames?: string[];
  resolvedRole?: string;
}

@Injectable()
export class RbacGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(RbacGuard.name);
  private readonly keycloakEnabled: boolean;
  private roleToolConfig: RoleToolConfig = new Map();

  constructor(
    private readonly config: ConfigService,
    private readonly rbac: RbacService,
    private readonly tools: ToolRegistryService,
  ) {
    this.keycloakEnabled = Boolean(this.config.get<string>("auth.keycloak.jwksUrl"));
  }

  onModuleInit(): void {
    // Validate ROLE_TOOL_CONFIG at startup so misconfiguration crashes early.
    this.roleToolConfig = this.rbac.parseRoleToolConfig(
      this.config.get<string>("auth.roleToolConfig"),
    );
    if (this.roleToolConfig.size > 0) {
      this.logger.log(`RBAC enabled with ${this.roleToolConfig.size} role mapping(s)`);
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RbacRequest>();
    const headerAdapter = {
      get: (name: string) => req.header(name) ?? null,
    };
    const role = this.rbac.resolveRole(headerAdapter, req.jwtRole ?? null, this.keycloakEnabled);
    const allowed = this.rbac.filterToolsForRole(this.tools.listNames(), role, this.roleToolConfig);
    req.resolvedRole = role;
    req.allowedToolNames = allowed;
    return true;
  }
}
