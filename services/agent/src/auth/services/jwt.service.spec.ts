import { JwtService } from "./jwt.service";

describe("JwtService", () => {
  let svc: JwtService;
  beforeEach(() => {
    svc = new JwtService();
  });

  describe("extractRole", () => {
    it("returns the first realm role when present", () => {
      expect(
        svc.extractRole({
          realm_access: { roles: ["admin", "user"] },
        }),
      ).toBe("admin");
    });

    it("falls back to top-level role claim", () => {
      expect(svc.extractRole({ role: "viewer" })).toBe("viewer");
    });

    it("returns null when no roles claim", () => {
      expect(svc.extractRole({ sub: "user-1" })).toBeNull();
    });

    it("returns null for empty realm_access.roles array", () => {
      expect(svc.extractRole({ realm_access: { roles: [] } })).toBeNull();
    });
  });
});
