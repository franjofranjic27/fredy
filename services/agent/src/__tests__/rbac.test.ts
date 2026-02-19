import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../tools/registry.js";
import {
  parseRoleToolConfig,
  filterToolsForRole,
  resolveRole,
  buildFilteredRegistry,
} from "../rbac.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(...names: string[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const name of names) {
    registry.register({
      name,
      description: `Tool ${name}`,
      inputSchema: z.object({}),
      execute: async () => name,
    });
  }
  return registry;
}

// ---------------------------------------------------------------------------
// parseRoleToolConfig
// ---------------------------------------------------------------------------

describe("parseRoleToolConfig", () => {
  it("returns null when input is undefined", () => {
    expect(parseRoleToolConfig(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRoleToolConfig("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseRoleToolConfig("   ")).toBeNull();
  });

  it("parses valid JSON correctly", () => {
    const raw = JSON.stringify({ admin: ["all"], user: ["search", "calc"] });
    const result = parseRoleToolConfig(raw);
    expect(result).toEqual({ admin: ["all"], user: ["search", "calc"] });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseRoleToolConfig("{not valid json}")).toThrow(
      "ROLE_TOOL_CONFIG is not valid JSON"
    );
  });

  it("throws when root value is an array", () => {
    expect(() => parseRoleToolConfig(JSON.stringify(["admin"]))).toThrow(
      "ROLE_TOOL_CONFIG must be a JSON object"
    );
  });

  it("throws when a role value is not an array of strings", () => {
    expect(() =>
      parseRoleToolConfig(JSON.stringify({ admin: "all" }))
    ).toThrow('ROLE_TOOL_CONFIG["admin"] must be an array of strings');
  });

  it("throws when a role array contains non-strings", () => {
    expect(() =>
      parseRoleToolConfig(JSON.stringify({ user: [1, 2] }))
    ).toThrow('ROLE_TOOL_CONFIG["user"] must be an array of strings');
  });
});

// ---------------------------------------------------------------------------
// filterToolsForRole
// ---------------------------------------------------------------------------

describe("filterToolsForRole", () => {
  const allTools = ["search", "fetch_url", "calc", "get_time"];

  it("returns all tools when config is null (no RBAC)", () => {
    expect(filterToolsForRole(allTools, "user", null)).toEqual(allTools);
  });

  it("returns all tools when role has 'all' entry", () => {
    const config = { admin: ["all"], user: ["search"] };
    expect(filterToolsForRole(allTools, "admin", config)).toEqual(allTools);
  });

  it("returns only allowed tools for configured role", () => {
    const config = { user: ["search", "calc"] };
    expect(filterToolsForRole(allTools, "user", config)).toEqual(["search", "calc"]);
  });

  it("ignores names in config that are not in allToolNames", () => {
    const config = { user: ["search", "nonexistent"] };
    expect(filterToolsForRole(allTools, "user", config)).toEqual(["search"]);
  });

  it("falls back to 'user' entry when role not in config", () => {
    const config = { user: ["search", "calc"] };
    expect(filterToolsForRole(allTools, "moderator", config)).toEqual(["search", "calc"]);
  });

  it("returns all tools when role not in config and no 'user' fallback", () => {
    const config = { admin: ["all"] };
    // Should still return all tools (with a console.warn)
    expect(filterToolsForRole(allTools, "unknown-role", config)).toEqual(allTools);
  });

  it("returns empty array when role has explicit empty list", () => {
    const config = { restricted: [] };
    expect(filterToolsForRole(allTools, "restricted", config)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveRole
// ---------------------------------------------------------------------------

describe("resolveRole", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns role from x-openwebui-user-role header", () => {
    const headers = { get: (n: string) => (n === "x-openwebui-user-role" ? "admin" : null) };
    expect(resolveRole(headers)).toBe("admin");
  });

  it("trims whitespace from header value", () => {
    const headers = { get: (n: string) => (n === "x-openwebui-user-role" ? "  admin  " : null) };
    expect(resolveRole(headers)).toBe("admin");
  });

  it("falls back to DEFAULT_ROLE env var when header is absent", () => {
    process.env.DEFAULT_ROLE = "operator";
    const headers = { get: () => null };
    expect(resolveRole(headers)).toBe("operator");
  });

  it("falls back to 'user' when neither header nor DEFAULT_ROLE is set", () => {
    delete process.env.DEFAULT_ROLE;
    const headers = { get: () => null };
    expect(resolveRole(headers)).toBe("user");
  });

  it("ignores empty header and falls back to DEFAULT_ROLE", () => {
    process.env.DEFAULT_ROLE = "viewer";
    const headers = { get: (n: string) => (n === "x-openwebui-user-role" ? "" : null) };
    expect(resolveRole(headers)).toBe("viewer");
  });
});

// ---------------------------------------------------------------------------
// buildFilteredRegistry
// ---------------------------------------------------------------------------

describe("buildFilteredRegistry", () => {
  it("returns a registry with only allowed tools", () => {
    const base = makeRegistry("search", "fetch_url", "calc");
    const config = { user: ["search", "calc"] };
    const filtered = buildFilteredRegistry(base, "user", config);
    expect(filtered.list().sort()).toEqual(["calc", "search"]);
  });

  it("excluded tools throw when executed", async () => {
    const base = makeRegistry("search", "fetch_url");
    const config = { user: ["search"] };
    const filtered = buildFilteredRegistry(base, "user", config);
    await expect(filtered.execute("fetch_url", {})).rejects.toThrow("Tool not found: fetch_url");
  });

  it("allowed tools can be executed", async () => {
    const base = makeRegistry("search");
    const config = { user: ["search"] };
    const filtered = buildFilteredRegistry(base, "user", config);
    const result = await filtered.execute("search", {});
    expect(result).toBe("search");
  });

  it("returns full registry when config is null", () => {
    const base = makeRegistry("a", "b", "c");
    const filtered = buildFilteredRegistry(base, "user", null);
    expect(filtered.list().sort()).toEqual(["a", "b", "c"]);
  });

  it("returns full registry for admin with 'all'", () => {
    const base = makeRegistry("search", "fetch_url", "calc");
    const config = { admin: ["all"], user: ["search"] };
    const filtered = buildFilteredRegistry(base, "admin", config);
    expect(filtered.list().sort()).toEqual(["calc", "fetch_url", "search"]);
  });

  it("does not mutate the base registry", () => {
    const base = makeRegistry("search", "fetch_url");
    const config = { user: ["search"] };
    buildFilteredRegistry(base, "user", config);
    // Base still has both tools
    expect(base.list().sort()).toEqual(["fetch_url", "search"]);
  });
});
