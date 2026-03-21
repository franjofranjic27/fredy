import type { SessionEntry, SessionStore } from "./types.js";

export class MemorySessionStore implements SessionStore {
  private readonly store = new Map<string, SessionEntry>();

  async get(sessionId: string): Promise<SessionEntry | undefined> {
    return this.store.get(sessionId);
  }

  async set(sessionId: string, entry: SessionEntry): Promise<void> {
    this.store.set(sessionId, entry);
  }

  async delete(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    const now = Date.now();
    for (const [id, entry] of this.store) {
      if (now - entry.lastActivity > maxAgeMs) {
        this.store.delete(id);
      }
    }
  }
}
