import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ToolsModule } from "../shared/tools/tools.module";
import { KeycloakAuthGuard } from "./guards/keycloak-auth.guard";
import { RbacGuard } from "./guards/rbac.guard";
import { JwtService } from "./services/jwt.service";
import { RbacService } from "./services/rbac.service";

@Module({
  imports: [ConfigModule, ToolsModule],
  providers: [JwtService, RbacService, KeycloakAuthGuard, RbacGuard],
  exports: [JwtService, RbacService, KeycloakAuthGuard, RbacGuard],
})
export class AuthModule {}
