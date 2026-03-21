import type { SessionEntry, SessionStore } from "./types.js";

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: string, time: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  disconnect(): void;
}

export class RedisSessionStore implements SessionStore {
  private readonly client: RedisClient;
  private readonly prefix = "fredy:session:";

  constructor(client: RedisClient) {
    this.client = client;
  }

  private key(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  async get(sessionId: string): Promise<SessionEntry | undefined> {
    const raw = await this.client.get(this.key(sessionId));
    if (!raw) return undefined;
    return JSON.parse(raw) as SessionEntry;
  }

  async set(sessionId: string, entry: SessionEntry): Promise<void> {
    // TTL = 30 minutes; Redis will expire the key automatically
    const ttlSeconds = Math.ceil(30 * 60);
    await this.client.set(this.key(sessionId), JSON.stringify(entry), "EX", ttlSeconds);
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.del(this.key(sessionId));
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    // Redis TTL handles expiry automatically; this is a manual sweep for
    // entries whose lastActivity has exceeded maxAgeMs even within TTL.
    const keys = await this.client.keys(`${this.prefix}*`);
    const cutoff = Date.now() - maxAgeMs;
    for (const key of keys) {
      const raw = await this.client.get(key);
      if (!raw) continue;
      const entry = JSON.parse(raw) as SessionEntry;
      if (entry.lastActivity < cutoff) {
        await this.client.del(key);
      }
    }
  }
}

export async function createRedisClient(redisUrl: string): Promise<RedisClient> {
  // Dynamic import so that ioredis is only loaded when Redis mode is requested
  const ioredis = await import("ioredis");
  const Redis = ioredis.default as unknown as new (url: string) => RedisClient;
  return new Redis(redisUrl);
}
