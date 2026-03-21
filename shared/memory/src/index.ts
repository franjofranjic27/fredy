export type { SessionEntry, SessionStore } from "./types.js";
export { MemorySessionStore } from "./memory.js";
export { RedisSessionStore, createRedisClient } from "./redis.js";

export async function createSessionStore(
  type: "memory" | "redis",
  redisUrl?: string,
): Promise<import("./types.js").SessionStore> {
  if (type === "redis") {
    const { RedisSessionStore, createRedisClient } = await import("./redis.js");
    const client = await createRedisClient(redisUrl ?? "redis://localhost:6379");
    return new RedisSessionStore(client);
  }
  const { MemorySessionStore } = await import("./memory.js");
  return new MemorySessionStore();
}
