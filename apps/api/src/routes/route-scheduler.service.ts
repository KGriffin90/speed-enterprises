import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { generateRoutesForTenant } from './route-generation';

/**
 * Recurrence scheduler for saved routes (route templates).
 *
 * Nightly, it fills each tenant's routes dashboard with PLANNED routes for the
 * upcoming week from their active saved routes (recurrence != NONE + a startDate
 * + a crew). Mirrors AutomationService's per-tenant pattern: iterate active
 * tenants from the catalog registry, open each tenant's own DB via
 * TenantDatabaseService.clientFor(), and generate against it. (A @Cron can't use
 * the request-scoped TENANT_DB the RoutesService uses, hence this singleton.)
 *
 * Idempotent — generation dedupes on (sourceTemplateId, plannedForDate), so a
 * saved route keeps generating each day until it's stopped (deleted).
 *
 * AUTOMATION_ENABLED=false disables it (tests / one-off dev sessions).
 */
@Injectable()
export class RouteSchedulerService {
  private readonly logger = new Logger(RouteSchedulerService.name);

  constructor(
    private catalog: CatalogPrismaService,
    private tenantDb: TenantDatabaseService,
  ) {}

  private isEnabled(): boolean {
    return process.env.AUTOMATION_ENABLED !== 'false';
  }

  // Daily at 4am — after the 3am job-status automation, before the workday.
  @Cron('0 4 * * *', { name: 'materialize-recurring-routes' })
  async materializeRecurringRoutes() {
    if (!this.isEnabled()) return;
    const tenants = await this.activeTenants();
    let created = 0;
    for (const t of tenants) {
      try {
        const db = await this.tenantDb.clientFor(t.id);
        created += await generateRoutesForTenant(db, t.id, {});
      } catch (err) {
        this.logger.error(`recurring routes failed for tenant=${t.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (created) this.logger.log(`Generated ${created} recurring route(s)`);
  }

  /** Active tenants from the catalog registry (mirrors AutomationService). */
  private async activeTenants() {
    return this.catalog.tenant.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] }, slug: { not: '_platform' } },
      select: { id: true, slug: true },
    });
  }
}
