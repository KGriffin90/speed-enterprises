import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Injects the resolved tenant id from TenantContext. Throws if no tenant
 * is in scope — pair with @UseGuards(TenantGuard) on routes that require it.
 *
 * Usage:
 *   @Get()
 *   list(@CurrentTenant() tenantId: string) { ... }
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    const tenantId = req.tenantContext?.tenantId;
    if (!tenantId) throw new Error('CurrentTenant: no tenant resolved — add TenantGuard');
    return tenantId;
  },
);
