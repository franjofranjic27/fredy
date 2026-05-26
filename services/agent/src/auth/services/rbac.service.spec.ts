import { RbacService } from "./rbac.service";

const headers = (record: Record<string, string>) => ({
  get: (name: string) => record[name.toLowerCase()] ?? null,
});

describe("RbacService", () => {
  let svc: RbacService;
  beforeEach(() => {
    svc = new RbacService();
  });

  describe("parseRoleToolConfig", () => {
    it("returns an empty map when no input", () => {
      expect(svc.parseRoleToolConfig(undefined).size).toBe(0);
      expect(svc.parseRoleToolConfig(null).size).toBe(0);
    });

    it("parses a valid JSON object into role → Set", () => {
      const config = svc.parseRoleToolConfig(
        '{"admin":["fetch_url","vector_search"],"user":["fetch_url"]}',
      );
      expect(config.size).toBe(2);
      expect(config.get("admin")).toEqual(new Set(["fetch_url", "vector_search"]));
    });

    it("throws on malformed JSON", () => {
      expect(() => svc.parseRoleToolConfig("not json")).toThrow(/not valid JSON/);
    });

    it("throws on non-object root", () => {
      expect(() => svc.parseRoleToolConfig("[]")).toThrow(/must be a JSON object/);
    });

    it("throws when a role's value is not a string array", () => {
      expect(() => svc.parseRoleToolConfig('{"admin":[1,2]}')).toThrow(/array of tool names/);
    });
  });

  describe("resolveRole", () => {
    it("prefers X-Role header even when Keycloak is enabled", () => {
      expect(svc.resolveRole(headers({ "x-role": "admin" }), "user", true)).toBe("admin");
    });

    it("uses JWT role when no header and Keycloak enabled", () => {
      expect(svc.resolveRole(headers({}), "user", true)).toBe("user");
    });

    it("falls back to default when no signals", () => {
      expect(svc.resolveRole(headers({}), null, true)).toBe("default");
      expect(svc.resolveRole(headers({}), null, false)).toBe("default");
    });

    it("ignores JWT role when Keycloak is disabled", () => {
      expect(svc.resolveRole(headers({}), "should-ignore", false)).toBe("default");
    });

    it("ignores whitespace-only header values", () => {
      expect(svc.resolveRole(headers({ "x-role": "   " }), "user", true)).toBe("user");
    });
  });

  describe("filterToolsForRole", () => {
    const all = ["vector_search", "fetch_url", "get_knowledge_base_stats"];

    it("returns everything when no config is loaded", () => {
      expect(svc.filterToolsForRole(all, "anyone", new Map())).toEqual(all);
    });

    it("intersects with the role's allowlist", () => {
      const config = new Map([["user", new Set(["fetch_url"])]]);
      expect(svc.filterToolsForRole(all, "user", config)).toEqual(["fetch_url"]);
    });

    it("falls back to the default entry for unknown roles", () => {
      const config = new Map([
        ["default", new Set(["vector_search"])],
        ["admin", new Set(["vector_search", "fetch_url"])],
      ]);
      expect(svc.filterToolsForRole(all, "guest", config)).toEqual(["vector_search"]);
    });

    it("denies everything when role is unknown and no default entry", () => {
      const config = new Map([["admin", new Set(all)]]);
      expect(svc.filterToolsForRole(all, "guest", config)).toEqual([]);
    });
  });
});
