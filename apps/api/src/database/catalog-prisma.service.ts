import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { loadTenancyConfig } from './tenancy.config';

/**
 * Control-plane database client.
 *
 * The catalog DB holds platform-level identity and the tenant registry — the
 * data that must be queried *before* we know which tenant database to talk to:
 *   • User / RefreshToken / VerificationToken / PlatformAdmin (auth & identity)
 *   • Tenant (slug, status, custom domain, ENCRYPTED per-tenant DB connection)
 *   • TenantMembership (which users may access which tenants)
 *   • ServiceTemplate (industry seed catalog)
 *
 * In TENANCY_MODE=pool this points at the same physical database as the tenant
 * data (DATABASE_URL), so nothing breaks before cut-over.
 *
 * It is a SEPARATE client instance from the per-tenant clients on purpose: the
 * catalog connection should never be used to read or write a tenant's business
 * rows. Routing that boundary lives in TenantDatabaseService.
 */
@Injectable()
export class CatalogPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogPrismaService.name);

  constructor() {
    const cfg = loadTenancyConfig();
    super({
      datasourceUrl: cfg.catalogUrl,
      errorFormat: 'minimal',
      log:
        process.env.NODE_ENV === 'production'
          ? [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]
          : [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to catalog (control-plane) database');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
