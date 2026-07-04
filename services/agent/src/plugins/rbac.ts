import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { filterToolsForRole, type Logger, type RoleToolConfig } from "@fredy/agent-core";
import type { AuthenticatedRequest } from "./auth.js";

export interface RbacRequest extends AuthenticatedRequest {
  resolvedRole?: string;
  allowedToolNames?: string[];
}

const DEFAULT_ROLE = "default";

/**
 * Decide which role applies to the current request.
 *
 * When Keycloak is enabled the role is derived EXCLUSIVELY from the verified
 * JWT — the X-Role / X-OpenWebUI-User-Role headers are ignored so a client
 * cannot escalate privileges by spoofing a header past the RBAC layer.
 *
 * Header-based roles are a DEV-ONLY convenience and only honoured when Keycloak
 * is disabled: X-Role → X-OpenWebUI-User-Role → "default".
 */
export function resolveRole(
  headers: { get(name: string): string | null | undefined },
  jwtRole: string | null,
  keycloakEnabled: boolean,
): string {
  if (keycloakEnabled) {
    return jwtRole ?? DEFAULT_ROLE;
  }
  const headerRole = headers.get("x-role");
  if (headerRole && headerRole.trim()) return headerRole.trim();
  const openWebUiRole = headers.get("x-openwebui-user-role");
  if (openWebUiRole && openWebUiRole.trim()) return openWebUiRole.trim();
  return DEFAULT_ROLE;
}

export interface RbacHookOptions {
  readonly keycloakEnabled: boolean;
  readonly roleToolConfig: RoleToolConfig;
  readonly listToolNames: () => string[];
  readonly logger: Logger;
}

function headerAccessor(request: FastifyRequest): { get(name: string): string | null } {
  return {
    get(name: string): string | null {
      const value = request.headers[name.toLowerCase()];
      if (Array.isArray(value)) return value[0] ?? null;
      return value ?? null;
    },
  };
}

/** Attaches resolvedRole and allowedToolNames to the request. */
export function createRbacHook(options: RbacHookOptions): preHandlerAsyncHookHandler {
  return async (request) => {
    const rbacRequest = request as RbacRequest;
    const role = resolveRole(
      headerAccessor(request),
      rbacRequest.jwtRole ?? null,
      options.keycloakEnabled,
    );
    rbacRequest.resolvedRole = role;
    rbacRequest.allowedToolNames = filterToolsForRole(
      options.listToolNames(),
      role,
      options.roleToolConfig,
      options.logger,
    );
  };
}
