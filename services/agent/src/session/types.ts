import type { Message } from "../llm/types.js";

export interface SessionEntry {
  messages: Message[];
  lastActivity: number;
}

export interface SessionStore {
  get(sessionId: string): Promise<SessionEntry | undefined>;
  set(sessionId: string, entry: SessionEntry): Promise<void>;
  delete(sessionId: string): Promise<void>;
  cleanup(maxAgeMs: number): Promise<void>;
}
