import { ConfigService } from "@nestjs/config";
import { MemorySessionStore } from "./memory-session.store";
import { SessionService } from "./session.service";

function createService(): { service: SessionService; store: MemorySessionStore } {
  const store = new MemorySessionStore();
  const config = { get: () => 1_000_000 } as unknown as ConfigService;
  const service = new SessionService(store, config);
  return { service, store };
}

describe("SessionService", () => {
  it("createSession returns a unique uuid", () => {
    const { service } = createService();
    const a = service.createSession();
    const b = service.createSession();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("appendMessages creates a new entry on first call", async () => {
    const { service, store } = createService();
    await service.appendMessages("s1", [{ role: "user", content: "hi" }]);
    const entry = await store.get("s1");
    expect(entry?.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(entry?.lastActivity).toBeGreaterThan(0);
  });

  it("appendMessages appends to existing entry", async () => {
    const { service, store } = createService();
    await service.appendMessages("s1", [{ role: "user", content: "a" }]);
    await service.appendMessages("s1", [{ role: "assistant", content: "b" }]);
    const entry = await store.get("s1");
    expect(entry?.messages.map((m) => m.content)).toEqual(["a", "b"]);
  });

  it("getSession returns undefined for unknown sessions", async () => {
    const { service } = createService();
    expect(await service.getSession("missing")).toBeUndefined();
  });

  it("deleteSession removes the entry", async () => {
    const { service, store } = createService();
    await service.appendMessages("s1", [{ role: "user", content: "x" }]);
    await service.deleteSession("s1");
    expect(await store.get("s1")).toBeUndefined();
  });
});
