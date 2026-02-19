import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisSessionStore } from "../../session/redis.js";
import type { SessionEntry } from "../../session/types.js";

function makeRedisClient() {
  const db = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => db.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      db.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      db.delete(key);
      return 1;
    }),
    keys: vi.fn(async (pattern: string) => {
      const prefix = pattern.replace("*", "");
      return [...db.keys()].filter((k) => k.startsWith(prefix));
    }),
    disconnect: vi.fn(),
    _db: db,
  };
}

describe("RedisSessionStore", () => {
  let redisClient: ReturnType<typeof makeRedisClient>;
  let store: RedisSessionStore;

  beforeEach(() => {
    redisClient = makeRedisClient();
    store = new RedisSessionStore(redisClient);
  });

  it("returns undefined for unknown session", async () => {
    expect(await store.get("missing")).toBeUndefined();
  });

  it("stores and retrieves a session", async () => {
    const entry: SessionEntry = { messages: [{ role: "user", content: "hi" }], lastActivity: 1000 };
    await store.set("s1", entry);
    const result = await store.get("s1");
    expect(result).toEqual(entry);
  });

  it("set calls redis SET with EX", async () => {
    const entry: SessionEntry = { messages: [], lastActivity: Date.now() };
    await store.set("s1", entry);
    expect(redisClient.set).toHaveBeenCalledWith(
      "fredy:session:s1",
      expect.any(String),
      "EX",
      1800,
    );
  });

  it("delete calls redis DEL with prefixed key", async () => {
    await store.delete("s1");
    expect(redisClient.del).toHaveBeenCalledWith("fredy:session:s1");
  });

  it("cleanup removes old sessions and keeps fresh ones", async () => {
    const now = Date.now();
    const old: SessionEntry = { messages: [], lastActivity: now - 200_000 };
    const fresh: SessionEntry = { messages: [], lastActivity: now };

    await store.set("old", old);
    await store.set("fresh", fresh);

    await store.cleanup(60_000);

    expect(await store.get("old")).toBeUndefined();
    expect(await store.get("fresh")).toBeDefined();
  });

  it("cleanup skips keys that have already expired in redis", async () => {
    // Simulate redis returning null for an already-expired key
    redisClient.keys.mockResolvedValueOnce(["fredy:session:gone"]);
    redisClient.get.mockResolvedValueOnce(null);

    await expect(store.cleanup(60_000)).resolves.toBeUndefined();
    // del should NOT have been called for the null entry
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it("get returns undefined when redis returns null", async () => {
    redisClient.get.mockResolvedValueOnce(null);
    expect(await store.get("nope")).toBeUndefined();
  });
});
