import { describe, expect, it, vi } from "vitest";
import { filterToolsForRole, parseRoleToolConfig } from "./rbac.js";

describe("parseRoleToolConfig", () => {
  it("returns an empty map when no input", () => {
    expect(parseRoleToolConfig(undefined).size).toBe(0);
    expect(parseRoleToolConfig(null).size).toBe(0);
    expect(parseRoleToolConfig("").size).toBe(0);
  });

  it("parses a valid JSON object into role → Set", () => {
    const config = parseRoleToolConfig(
      '{"admin":["fetch_url","vector_search"],"user":["fetch_url"]}',
    );
    expect(config.size).toBe(2);
    expect(config.get("admin")).toEqual(new Set(["fetch_url", "vector_search"]));
  });

  it("throws on malformed JSON", () => {
    expect(() => parseRoleToolConfig("not json")).toThrow(/not valid JSON/);
  });

  it("throws on non-object root", () => {
    expect(() => parseRoleToolConfig("[]")).toThrow(/must be a JSON object/);
  });

  it("throws when a role's value is not a string array", () => {
    expect(() => parseRoleToolConfig('{"admin":[1,2]}')).toThrow(/array of tool names/);
  });
});

describe("filterToolsForRole", () => {
  const all = ["vector_search", "fetch_url", "get_knowledge_base_stats"];

  it("returns everything when no config is loaded", () => {
    expect(filterToolsForRole(all, "anyone", new Map())).toEqual(all);
  });

  it("intersects with the role's allowlist", () => {
    const config = new Map([["user", new Set(["fetch_url"])]]);
    expect(filterToolsForRole(all, "user", config)).toEqual(["fetch_url"]);
  });

  it("falls back to the default entry for unknown roles", () => {
    const config = new Map([
      ["default", new Set(["vector_search"])],
      ["admin", new Set(["vector_search", "fetch_url"])],
    ]);
    expect(filterToolsForRole(all, "guest", config)).toEqual(["vector_search"]);
  });

  it("denies everything when role is unknown and no default entry — with a warning", () => {
    const warn = vi.fn();
    const config = new Map([["admin", new Set(all)]]);
    expect(filterToolsForRole(all, "guest", config, { warn })).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      { role: "guest" },
      expect.stringContaining('Role "guest" not present in ROLE_TOOL_CONFIG'),
    );
  });
});
