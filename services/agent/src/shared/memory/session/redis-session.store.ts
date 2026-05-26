import { Logger } from "@nestjs/common";
import Redis, { Redis as RedisClient } from "ioredis";
import { SessionEntry, SessionStore } from "./session.types";

const KEY_PREFIX = "fredy:session:";

export async function createRedisClient(url: string): Promise<RedisClient> {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
  await client.connect();
  return client;
}

export class RedisSessionStore implements SessionStore {
  private readonly logger = new Logger(RedisSessionStore.name);

  constructor(private readonly client: RedisClient) {}

  private key(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
  }

  async get(sessionId: string): Promise<SessionEntry | undefined> {
    const raw = await this.client.get(this.key(sessionId));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as SessionEntry;
    } catch (error) {
      this.logger.warn(`Failed to parse session ${sessionId}: ${(error as Error).message}`);
      return undefined;
    }
  }

  async set(sessionId: string, entry: SessionEntry): Promise<void> {
    await this.client.set(this.key(sessionId), JSON.stringify(entry));
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.del(this.key(sessionId));
  }

  async cleanup(ttlMs: number): Promise<number> {
    const cutoff = Date.now() - ttlMs;
    const pattern = `${KEY_PREFIX}*`;
    let removed = 0;
    let cursor = "0";
    do {
      const [next, keys] = await this.client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      if (keys.length === 0) continue;
      const entries = await this.client.mget(keys);
      const toDelete: string[] = [];
      for (let i = 0; i < entries.length; i += 1) {
        const raw = entries[i];
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as SessionEntry;
          if (parsed.lastActivity < cutoff) toDelete.push(keys[i]);
        } catch {
          toDelete.push(keys[i]);
        }
      }
      if (toDelete.length > 0) {
        await this.client.del(...toDelete);
        removed += toDelete.length;
      }
    } while (cursor !== "0");
    return removed;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
