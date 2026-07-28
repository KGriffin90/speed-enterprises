import { Global, Module } from '@nestjs/common';
import { CatalogPrismaService } from './catalog-prisma.service';
import { TenantDatabaseService } from './tenant-database.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { tenantDbProvider, TENANT_DB } from './tenant-db.provider';

/**
 * Control-plane / data-plane database wiring.
 *
 *   CatalogPrismaService      — singleton, control-plane DB (identity + registry)
 *   TenantDatabaseService     — singleton, owns per-tenant connection pools
 *   TenantProvisioningService — creates/migrates/destroys tenant databases
 *   TENANT_DB                 — request-scoped PrismaClient for the active tenant
 *
 * Global so any feature module can `@Inject(TENANT_DB)` or inject the catalog
 * client without re-importing. Relies on PrismaModule (shared client) and
 * TenantModule (TenantContext), both already @Global.
 */
@Global()
@Module({
  providers: [CatalogPrismaService, TenantDatabaseService, TenantProvisioningService, tenantDbProvider],
  exports: [CatalogPrismaService, TenantDatabaseService, TenantProvisioningService, TENANT_DB],
})
export class DatabaseModule {}
