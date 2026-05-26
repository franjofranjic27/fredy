import { Injectable, Logger } from "@nestjs/common";

export type RoleToolConfig = Map<string, Set<string>>;

const DEFAULT_ROLE = "default";

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  parseRoleToolConfig(raw?: string | null): RoleToolConfig {
    if (!raw) return new Map();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`ROLE_TOOL_CONFIG is not valid JSON: ${(error as Error).message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("ROLE_TOOL_CONFIG must be a JSON object");
    }
    const result: RoleToolConfig = new Map();
    for (const [role, tools] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(tools) || !tools.every((t) => typeof t === "string")) {
        throw new Error(`ROLE_TOOL_CONFIG.${role} must be an array of tool names`);
      }
      result.set(role, new Set(tools));
    }
    return result;
  }

  /**
   * Decide which role applies to the current request.
   * Priority: explicit X-Role header (always honoured for dev/test),
   * then JWT role, then "default".
   */
  resolveRole(
    headers: { get(name: string): string | null | undefined },
    jwtRole: string | null,
    keycloakEnabled: boolean,
  ): string {
    const headerRole = headers.get("x-role");
    if (headerRole && headerRole.trim()) return headerRole.trim();
    if (keycloakEnabled && jwtRole) return jwtRole;
    return DEFAULT_ROLE;
  }

  /**
   * Returns the set of tool names a role is allowed to use.
   * - Missing config → no restriction (allowAll).
   * - Role present in config → return its allowlist (may be empty).
   * - Role missing from config → fall back to "default" entry, else allowAll.
   */
  filterToolsForRole(allToolNames: string[], role: string, config: RoleToolConfig): string[] {
    if (config.size === 0) return [...allToolNames];
    const allow = config.get(role) ?? config.get(DEFAULT_ROLE);
    if (!allow) {
      this.logger.warn(
        `Role "${role}" not present in ROLE_TOOL_CONFIG and no default entry — denying all tools`,
      );
      return [];
    }
    return allToolNames.filter((name) => allow.has(name));
  }
}
