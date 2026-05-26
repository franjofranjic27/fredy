export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SessionEntry {
  messages: SessionMessage[];
  lastActivity: number;
}

export interface SessionStore {
  get(sessionId: string): Promise<SessionEntry | undefined>;
  set(sessionId: string, entry: SessionEntry): Promise<void>;
  delete(sessionId: string): Promise<void>;
  cleanup(ttlMs: number): Promise<number>;
  close(): Promise<void>;
}

export const SESSION_STORE = Symbol("SESSION_STORE");

export type SessionStoreType = "memory" | "redis";
