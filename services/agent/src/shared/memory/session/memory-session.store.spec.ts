import { MemorySessionStore } from "./memory-session.store";

describe("MemorySessionStore", () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore();
  });

  it("returns undefined for unknown sessions", async () => {
    expect(await store.get("missing")).toBeUndefined();
  });

  it("persists and retrieves an entry", async () => {
    await store.set("s1", { messages: [], lastActivity: 1000 });
    const got = await store.get("s1");
    expect(got).toEqual({ messages: [], lastActivity: 1000 });
  });

  it("deletes an entry", async () => {
    await store.set("s1", { messages: [], lastActivity: 1000 });
    await store.delete("s1");
    expect(await store.get("s1")).toBeUndefined();
  });

  it("cleanup removes entries older than the TTL cutoff", async () => {
    const now = Date.now();
    await store.set("old", { messages: [], lastActivity: now - 60_000 });
    await store.set("fresh", { messages: [], lastActivity: now });
    const removed = await store.cleanup(30_000);
    expect(removed).toBe(1);
    expect(await store.get("old")).toBeUndefined();
    expect(await store.get("fresh")).toBeDefined();
  });

  it("close clears all entries", async () => {
    await store.set("a", { messages: [], lastActivity: 1 });
    await store.close();
    expect(await store.get("a")).toBeUndefined();
  });
});
