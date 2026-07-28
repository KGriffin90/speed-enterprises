import { Provider, Scope, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';
import { TenantDatabaseService } from './tenant-database.service';

/**
 * Injection token for the request's tenant database client.
 *
 *   constructor(@Inject(TENANT_DB) private db: PrismaClient) {}
 *
 * This is the seam every tenant-business service should use instead of the raw
 * singleton PrismaService. It is request-scoped: the factory below runs once
 * per HTTP request, AFTER TenantMiddleware has resolved the tenant, and returns
 * the PrismaClient bound to that tenant's database.
 *
 *   • pool mode          → the shared client (row-level scoping still applies).
 *   • db-per-tenant mode → the tenant's dedicated, pooled client.
 *
 * It fails closed: if no tenant is in scope it throws rather than handing back a
 * client that could read another tenant's data. Endpoints that legitimately
 * have no tenant (platform admin, auth, health) must use CatalogPrismaService.
 */
export const TENANT_DB = Symbol('TENANT_DB');

export const tenantDbProvider: Provider = {
  provide: TENANT_DB,
  scope: Scope.REQUEST,
  inject: [TenantDatabaseService, TenantContext],
  useFactory: async (db: TenantDatabaseService, ctx: TenantContext): Promise<PrismaClient> => {
    const tenantId = ctx.tenantId;
    if (!tenantId) {
      throw new ServiceUnavailableException(
        'No tenant resolved for this request; refusing to issue a tenant database client.',
      );
    }
    return db.clientFor(tenantId);
  },
};
