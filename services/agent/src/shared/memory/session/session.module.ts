import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MemorySessionStore } from "./memory-session.store";
import { createRedisClient, RedisSessionStore } from "./redis-session.store";
import { SessionService } from "./session.service";
import { SESSION_STORE, SessionStore } from "./session.types";

@Module({
  imports: [ConfigModule],
  providers: [
    SessionService,
    {
      provide: SESSION_STORE,
      useFactory: async (config: ConfigService): Promise<SessionStore> => {
        const type = config.get<string>("session.storeType") ?? "memory";
        if (type === "redis") {
          const url = config.get<string>("session.redisUrl") ?? "redis://localhost:6379";
          const client = await createRedisClient(url);
          return new RedisSessionStore(client);
        }
        return new MemorySessionStore();
      },
      inject: [ConfigService],
    },
  ],
  exports: [SessionService, SESSION_STORE],
})
export class SessionModule {}
