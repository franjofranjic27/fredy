import { Body, Controller, Get, Post, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import { Request, Response } from "express";
import { KeycloakAuthGuard } from "../../auth/guards/keycloak-auth.guard";
import { RbacGuard } from "../../auth/guards/rbac.guard";
import { RateLimitInterceptor } from "../../middleware/rate-limit.interceptor";
import { WebService } from "./web.service";

@Controller()
@UseGuards(KeycloakAuthGuard)
export class WebController {
  constructor(private readonly web: WebService) {}

  @Get("health")
  health(): { status: string } {
    return { status: "ok" };
  }

  @Get("v1/models")
  async listModels() {
    return this.web.listModels();
  }

  @Post("v1/chat/completions")
  @UseGuards(RbacGuard)
  @UseInterceptors(RateLimitInterceptor)
  async chatCompletions(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    await this.web.handleChatCompletion(req, res, body);
  }
}
