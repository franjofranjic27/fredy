import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemorySessionStore } from "../../session/memory.js";

describe("MemorySessionStore", () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore();
  });

  it("returns undefined for unknown session", async () => {
    expect(await store.get("missing")).toBeUndefined();
  });

  it("stores and retrieves a session", async () => {
    const entry = { messages: [{ role: "user" as const, content: "hi" }], lastActivity: Date.now() };
    await store.set("s1", entry);
    expect(await store.get("s1")).toEqual(entry);
  });

  it("overwrites an existing session", async () => {
    const first = { messages: [], lastActivity: 1000 };
    const second = { messages: [{ role: "user" as const, content: "hello" }], lastActivity: 2000 };
    await store.set("s1", first);
    await store.set("s1", second);
    expect(await store.get("s1")).toEqual(second);
  });

  it("deletes a session", async () => {
    await store.set("s1", { messages: [], lastActivity: Date.now() });
    await store.delete("s1");
    expect(await store.get("s1")).toBeUndefined();
  });

  it("delete is a no-op for unknown session", async () => {
    await expect(store.delete("nope")).resolves.toBeUndefined();
  });

  it("cleanup removes sessions older than maxAgeMs", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    await store.set("old", { messages: [], lastActivity: now - 100_000 });
    await store.set("fresh", { messages: [], lastActivity: now });

    await store.cleanup(60_000);

    expect(await store.get("old")).toBeUndefined();
    expect(await store.get("fresh")).toBeDefined();
    vi.useRealTimers();
  });

  it("cleanup keeps sessions within maxAgeMs", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    await store.set("recent", { messages: [], lastActivity: now - 1000 });

    await store.cleanup(60_000);

    expect(await store.get("recent")).toBeDefined();
    vi.useRealTimers();
  });

  it("cleanup with empty store does not throw", async () => {
    await expect(store.cleanup(60_000)).resolves.toBeUndefined();
  });
});
