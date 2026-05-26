import { Injectable } from "@nestjs/common";
import { SessionEntry, SessionStore } from "./session.types";

@Injectable()
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionEntry>();

  async get(sessionId: string): Promise<SessionEntry | undefined> {
    return this.sessions.get(sessionId);
  }

  async set(sessionId: string, entry: SessionEntry): Promise<void> {
    this.sessions.set(sessionId, entry);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async cleanup(ttlMs: number): Promise<number> {
    const cutoff = Date.now() - ttlMs;
    let removed = 0;
    for (const [id, entry] of this.sessions.entries()) {
      if (entry.lastActivity < cutoff) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async close(): Promise<void> {
    this.sessions.clear();
  }
}
