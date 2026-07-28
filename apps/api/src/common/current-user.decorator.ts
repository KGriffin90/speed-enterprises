import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { PlatformRole, TenantRole } from '@speed-enterprises/shared';

export interface CurrentUserInfo {
  id:           string;
  email:        string;
  platformRole: PlatformRole;
  tenantRole?:  TenantRole;
  tenantId?:    string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserInfo => {
    const req = ctx.switchToHttp().getRequest();
    const c = req.tenantContext;
    if (!c?.userId) throw new UnauthorizedException();
    return {
      id:           c.userId,
      email:        c.userEmail,
      platformRole: c.platformRole,
      tenantRole:   c.tenantRole ?? undefined,
      tenantId:     c.tenantId ?? undefined,
    };
  },
);
