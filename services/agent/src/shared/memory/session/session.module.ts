import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MemorySessionStore } from "./memory-session.store";
import { SessionService } from "./session.service";
import { SESSION_STORE } from "./session.types";

@Module({
  imports: [ConfigModule],
  providers: [
    SessionService,
    {
      provide: SESSION_STORE,
      useClass: MemorySessionStore,
    },
  ],
  exports: [SessionService, SESSION_STORE],
})
export class SessionModule {}
