import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { SESSION_STORE, SessionEntry, SessionMessage, SessionStore } from "./session.types";

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name);
  private readonly ttlMs: number;
  private cleanupHandle: NodeJS.Timeout | null = null;

  constructor(
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    config: ConfigService,
  ) {
    this.ttlMs = config.get<number>("session.ttlMs") ?? DEFAULT_TTL_MS;
  }

  onModuleInit(): void {
    this.cleanupHandle = setInterval(() => {
      void this.store.cleanup(this.ttlMs).catch((error) => {
        this.logger.warn(`Session cleanup failed: ${(error as Error).message}`);
      });
    }, this.ttlMs);
    this.cleanupHandle.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupHandle) clearInterval(this.cleanupHandle);
    await this.store.close();
  }

  createSession(): string {
    return randomUUID();
  }

  async getSession(sessionId: string): Promise<SessionEntry | undefined> {
    return this.store.get(sessionId);
  }

  async appendMessages(sessionId: string, messages: SessionMessage[]): Promise<SessionEntry> {
    const existing = (await this.store.get(sessionId)) ?? {
      messages: [],
      lastActivity: Date.now(),
    };
    existing.messages.push(...messages);
    existing.lastActivity = Date.now();
    await this.store.set(sessionId, existing);
    return existing;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }
}
