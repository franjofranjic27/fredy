import { ToolRegistry } from "./tools/registry.js";

export type Role = string;
export type RoleToolConfig = Record<Role, string[]>;

/**
 * Parse ROLE_TOOL_CONFIG env var once at startup.
 * Returns null when unconfigured (backward-compat: no RBAC).
 * Throws on invalid JSON or wrong shape.
 */
export function parseRoleToolConfig(raw: string | undefined): RoleToolConfig | null {
  if (raw === undefined || raw.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`ROLE_TOOL_CONFIG is not valid JSON: ${raw}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("ROLE_TOOL_CONFIG must be a JSON object mapping role names to string arrays");
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      throw new Error(`ROLE_TOOL_CONFIG["${key}"] must be an array of strings`);
    }
  }

  return parsed as RoleToolConfig;
}

/**
 * Filter tool names based on role and config.
 * - config null  → all tools (no RBAC configured)
 * - config[role] contains "all" → all tools
 * - config[role] defined → only those names
 * - role not in config → fallback to config["user"] → fallback to all tools + warning
 */
export function filterToolsForRole(
  allToolNames: string[],
  role: Role,
  config: RoleToolConfig | null
): string[] {
  if (config === null) return allToolNames;

  if (role in config) {
    const allowed = config[role]!;
    if (allowed.includes("all")) return allToolNames;
    return allToolNames.filter((name) => allowed.includes(name));
  }

  // Role not explicitly configured — fall back to "user" entry
  if ("user" in config) {
    const userAllowed = config["user"]!;
    if (userAllowed.includes("all")) return allToolNames;
    return allToolNames.filter((name) => userAllowed.includes(name));
  }

  // No fallback available — log warning and allow all
  console.warn(`[rbac] Role "${role}" not found in ROLE_TOOL_CONFIG and no "user" fallback — allowing all tools`);
  return allToolNames;
}

/**
 * Resolve the effective role for a request.
 * Priority: x-openwebui-user-role header → DEFAULT_ROLE env var → "user"
 */
export function resolveRole(headers: { get(name: string): string | null | undefined }): Role {
  const fromHeader = headers.get("x-openwebui-user-role");
  if (fromHeader && fromHeader.trim() !== "") return fromHeader.trim();

  const fromEnv = process.env.DEFAULT_ROLE;
  if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();

  return "user";
}

/**
 * Build a new ToolRegistry containing only the tools allowed for the given role.
 * Uses only public ToolRegistry API: list(), get(), register().
 */
export function buildFilteredRegistry(
  base: ToolRegistry,
  role: Role,
  config: RoleToolConfig | null
): ToolRegistry {
  const allowed = new Set(filterToolsForRole(base.list(), role, config));
  const filtered = new ToolRegistry();
  for (const name of allowed) {
    const tool = base.get(name);
    if (tool) filtered.register(tool);
  }
  return filtered;
}
