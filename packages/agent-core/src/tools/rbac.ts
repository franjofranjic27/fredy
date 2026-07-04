export type RoleToolConfig = Map<string, Set<string>>;

export const DEFAULT_ROLE = "default";

/**
 * Parses the ROLE_TOOL_CONFIG env value ({"role": ["tool", ...]}) into a
 * role → allowlist map. Throws with a readable message on any malformation so
 * misconfiguration crashes the service at boot.
 */
export function parseRoleToolConfig(raw?: string | null): RoleToolConfig {
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
 * Returns the tool names a role may use.
 * - Empty config → no restriction (all tools).
 * - Role present in config → its allowlist (may be empty).
 * - Role absent → the "default" entry, else deny all (with a warning).
 */
export function filterToolsForRole(
  allToolNames: readonly string[],
  role: string,
  config: RoleToolConfig,
  logger?: { warn(obj: unknown, msg?: string): void },
): string[] {
  if (config.size === 0) return [...allToolNames];
  const allow = config.get(role) ?? config.get(DEFAULT_ROLE);
  if (!allow) {
    logger?.warn(
      { role },
      `Role "${role}" not present in ROLE_TOOL_CONFIG and no default entry — denying all tools`,
    );
    return [];
  }
  return allToolNames.filter((name) => allow.has(name));
}
