/**
 * Stage 4 distribution: split the fully-seeded shared database into the
 * db-per-tenant topology.
 *
 *   • Identity + registry  → catalog DB (speed_catalog)
 *       User, PlatformAdmin, TenantMembership, ServiceTemplate, VerificationToken
 *       (the Tenant registry rows are already present from the Stage 2 bootstrap)
 *   • Business data        → each tenant's own database
 *       TenantConfig, Service, AutomationTemplate, EmployeeProfile, and any
 *       customer/quote/appointment rows (filtered by tenantId)
 *
 * Idempotent (createMany skipDuplicates). Reads from DATABASE_URL (speed_enterprises),
 * writes to CATALOG_DATABASE_URL and to each tenant DB resolved by decrypting the
 * connection string stored on the catalog Tenant row.
 *
 * Run:
 *   pnpm --filter @speed-enterprises/api exec dotenv -e .env -- \
 *     sh -c 'CATALOG_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/speed_catalog?schema=public tsx scripts/distribute-to-tenant-dbs.ts'
 */
import { PrismaClient } from '@prisma/client';
import { decryptSecret, keyRingFromEnv } from '../src/database/connection-secret';

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

async function main() {
  const sourceUrl  = reqEnv('DATABASE_URL');
  const catalogUrl = reqEnv('CATALOG_DATABASE_URL');
  const keyRing    = keyRingFromEnv(reqEnv('TENANT_SECRET_KEYS'));

  const source  = new PrismaClient({ datasourceUrl: sourceUrl });
  const catalog = new PrismaClient({ datasourceUrl: catalogUrl });

  console.log('▶ Stage 4: distribute shared DB → catalog + per-tenant DBs\n');

  // ── 1. Identity + platform catalog → catalog DB ────────────────────────────
  console.log('1) Identity + platform catalog → catalog');
  const [users, platformAdmins, memberships, serviceTemplates, verificationTokens] = await Promise.all([
    source.user.findMany(),
    source.platformAdmin.findMany(),
    source.tenantMembership.findMany(),
    source.serviceTemplate.findMany(),
    source.verificationToken.findMany(),
  ]);
  await catalog.user.createMany({ data: users, skipDuplicates: true });
  await catalog.platformAdmin.createMany({ data: platformAdmins, skipDuplicates: true });
  await catalog.tenantMembership.createMany({ data: memberships, skipDuplicates: true });
  await catalog.serviceTemplate.createMany({ data: serviceTemplates, skipDuplicates: true });
  await catalog.verificationToken.createMany({ data: verificationTokens, skipDuplicates: true });
  console.log(`   users=${users.length} admins=${platformAdmins.length} memberships=${memberships.length} templates=${serviceTemplates.length}\n`);

  // membershipId → tenantId, to route EmployeeProfile (which has no tenantId).
  const tenantByMembership = new Map(memberships.map((m) => [m.id, m.tenantId]));

  // ── 2. Business data → each tenant's own database ──────────────────────────
  console.log('2) Business data → per-tenant databases');
  const tenants = await catalog.tenant.findMany({
    where: { dbStatus: 'READY' },
    select: { id: true, slug: true, dbConnectionEnc: true },
  });

  for (const t of tenants) {
    if (!t.dbConnectionEnc) { console.log(`   • ${t.slug}: no connection — skipped`); continue; }
    const url = decryptSecret(t.dbConnectionEnc, keyRing);
    const db = new PrismaClient({ datasourceUrl: url });
    try {
      // tenantId-keyed models, in FK-safe order (self Tenant row already exists).
      const [config, services, templates, customerProfiles] = await Promise.all([
        source.tenantConfig.findMany({ where: { tenantId: t.id } }),
        source.service.findMany({ where: { tenantId: t.id } }),
        source.automationTemplate.findMany({ where: { tenantId: t.id } }),
        source.customerProfile.findMany({ where: { tenantId: t.id } }),
      ]);
      await db.tenantConfig.createMany({ data: config, skipDuplicates: true });
      await db.service.createMany({ data: services, skipDuplicates: true });
      await db.automationTemplate.createMany({ data: templates, skipDuplicates: true });
      await db.customerProfile.createMany({ data: customerProfiles, skipDuplicates: true });

      // EmployeeProfile is keyed by membership; select the ones for this tenant.
      const allProfiles = await source.employeeProfile.findMany();
      const tenantProfiles = allProfiles.filter((p) => tenantByMembership.get(p.membershipId) === t.id);
      await db.employeeProfile.createMany({ data: tenantProfiles, skipDuplicates: true });

      // Quotes + descendants (filtered by tenantId). Usually empty post-wipe.
      const quotes = await source.quoteRequest.findMany({ where: { tenantId: t.id } });
      if (quotes.length) {
        const quoteIds = quotes.map((q) => q.id);
        const [lineItems, history, images, emailLogs] = await Promise.all([
          source.quoteLineItem.findMany({ where: { tenantId: t.id } }),
          source.quoteStatusHistory.findMany({ where: { tenantId: t.id } }),
          source.uploadedImage.findMany({ where: { tenantId: t.id } }),
          source.emailLog.findMany({ where: { tenantId: t.id } }),
        ]);
        await db.quoteRequest.createMany({ data: quotes, skipDuplicates: true });
        await db.quoteLineItem.createMany({ data: lineItems, skipDuplicates: true });
        await db.quoteStatusHistory.createMany({ data: history, skipDuplicates: true });
        await db.uploadedImage.createMany({ data: images.filter((i) => quoteIds.includes(i.quoteRequestId ?? '')), skipDuplicates: true });
        await db.emailLog.createMany({ data: emailLogs, skipDuplicates: true });
      }

      console.log(`   • ${t.slug}: config=${config.length} services=${services.length} templates=${templates.length} profiles=${tenantProfiles.length} quotes=${quotes.length}`);
    } finally {
      await db.$disconnect();
    }
  }

  await source.$disconnect();
  await catalog.$disconnect();
  console.log('\n✓ Distribution complete. Flip TENANCY_MODE=db-per-tenant + CATALOG_DATABASE_URL to cut over.');
}

main().catch((err) => {
  console.error('\n✗ Distribution failed:', err);
  process.exit(1);
});
