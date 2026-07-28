import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext } from '../tenant/tenant-context';
import { tenantRoleAtLeast, TenantRole, PlatformRole } from '@speed-enterprises/shared';

/** Asserts a tenant is resolved on the request. */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private ctx: TenantContext) {}
  canActivate(_ctx: ExecutionContext): boolean {
    if (!this.ctx.hasTenant) throw new ForbiddenException('No tenant in scope');
    return true;
  }
}

/** Asserts the request is authenticated (any tenant or platform role). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private ctx: TenantContext) {}
  canActivate(_ctx: ExecutionContext): boolean {
    if (!this.ctx.isAuthenticated) throw new UnauthorizedException();
    return true;
  }
}

// ── Role decorators + guard ───────────────────────────────────────────────
export const TENANT_ROLE_KEY = 'tenantRoleAtLeast';
export const PLATFORM_ROLE_KEY = 'platformRole';

export const RequireTenantRole = (role: TenantRole) => SetMetadata(TENANT_ROLE_KEY, role);
export const RequirePlatformRole = (role: PlatformRole) => SetMetadata(PLATFORM_ROLE_KEY, role);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector, private ctx: TenantContext) {}
  canActivate(execCtx: ExecutionContext): boolean {
    const platformRoleNeeded = this.reflector.getAllAndOverride<PlatformRole | undefined>(
      PLATFORM_ROLE_KEY,
      [execCtx.getHandler(), execCtx.getClass()],
    );
    const tenantRoleNeeded = this.reflector.getAllAndOverride<TenantRole | undefined>(
      TENANT_ROLE_KEY,
      [execCtx.getHandler(), execCtx.getClass()],
    );

    if (platformRoleNeeded && this.ctx.platformRole !== platformRoleNeeded) {
      // Platform-admins satisfy any platform role check
      if (platformRoleNeeded === 'PLATFORM_ADMIN' && !this.ctx.isPlatformAdmin) {
        throw new ForbiddenException(`Requires platform role ${platformRoleNeeded}`);
      }
    }

    if (tenantRoleNeeded) {
      if (!this.ctx.isAuthenticated) throw new UnauthorizedException();
      if (this.ctx.isPlatformAdmin) return true; // platform admin bypass
      if (!this.ctx.tenantRole || !tenantRoleAtLeast(this.ctx.tenantRole, tenantRoleNeeded)) {
        throw new ForbiddenException(`Requires tenant role >= ${tenantRoleNeeded}`);
      }
    }

    return true;
  }
}
