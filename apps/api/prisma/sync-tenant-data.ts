/**
 * Fan-out DATA sync for db-per-tenant deployments (and harmless in pool mode).
 *
 *   pnpm --filter @speed-enterprises/api db:sync-tenant-data            # apply
 *   pnpm --filter @speed-enterprises/api db:sync-tenant-data -- --dry-run
 *
 * The seeds in ./seeds write business rows (TenantConfig, Service) through a
 * single PrismaClient — that's only valid in pool mode. After the Stage-4
 * cut-over (TENANCY_MODE=db-per-tenant) business data lives in each tenant's
 * OWN database, so this script routes the same updates to the right DB:
 *
 *   1. branding.heroImageUrl — merged into each tenant's existing branding
 *      JSON (admin customizations survive).
 *   2. speedenterprises: window-cleaning services upserted from
 *      SERVICE_TEMPLATES (adds the AR `measurement` questions and the
 *      commercial `ar_measurement` capability).
 *
 * Run prisma/migrate-all-tenants.ts FIRST so tenant DB schemas are current.
 */
import { PrismaClient } from '@prisma/client';
import { SERVICE_TEMPLATES } from './seeds/service-templates';
import { loadTenancyConfig } from '../src/database/tenancy.config';
import { decryptSecret, keyRingFromEnv } from '../src/database/connection-secret';

const HERO: Record<string, string> = {
  'speedenterprises': 'https://images.unsplash.com/photo-1769788161278-8dc624a2d537?w=1920&h=1080&auto=format&fit=crop&q=80',
  'acme-plumbing':    'https://images.unsplash.com/photo-1749532125405-70950966b0e5?w=1920&h=1080&auto=format&fit=crop&q=80',
  'es-solar':         'https://images.unsplash.com/photo-1660330589505-9a433a742a7b?w=1920&h=1080&auto=format&fit=crop&q=80',
  'hunt-electric':    'https://images.unsplash.com/photo-1635335874521-7987db781153?w=1920&h=1080&auto=format&fit=crop&q=80',
};

async function syncTenant(slug: string, tenantId: string, db: PrismaClient, dryRun: boolean) {
  // 1) Hero image → branding merge
  const hero = HERO[slug];
  if (hero) {
    const cfg = await db.tenantConfig.findUnique({ where: { tenantId }, select: { branding: true } });
    if (!cfg) {
      console.warn(`  ! ${slug}: no TenantConfig row in tenant DB — skipping branding`);
    } else if ((cfg.branding as any)?.heroImageUrl === hero) {
      console.log(`  ✓ ${slug}: heroImageUrl already current`);
    } else {
      console.log(`  ${dryRun ? '[dry-run] would set' : '~ setting'} heroImageUrl for ${slug}`);
      if (!dryRun) {
        await db.tenantConfig.update({
          where: { tenantId },
          data: { branding: { ...((cfg.branding as any) ?? {}), heroImageUrl: hero } as any },
        });
      }
    }
  }

  // 2) Window-cleaning service definitions (Speed Enterprises)
  if (slug === 'speedenterprises') {
    const wc = SERVICE_TEMPLATES.filter(t => t.industry === 'WINDOW_CLEANING');
    for (const t of wc) {
      const svcSlug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      console.log(`  ${dryRun ? '[dry-run] would upsert' : '~ upserting'} service ${svcSlug}`);
      if (dryRun) continue;
      const fields = {
        name: t.name, category: t.category, description: t.description,
        iconKey: t.iconKey, basePriceCents: t.recommendedBasePriceCents,
        pricingMode: t.pricingMode, questions: t.questions as any,
        pricingRules: t.pricingRules as any, lineItemKinds: t.lineItemKinds,
        capabilities: t.capabilities, sortOrder: t.sortOrder,
      };
      await db.service.upsert({
        where:  { tenantId_slug: { tenantId, slug: svcSlug } },
        create: { tenantId, slug: svcSlug, ...fields },
        update: fields,
      });
    }
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const cfg = loadTenancyConfig();
  const catalog = new PrismaClient({ datasourceUrl: cfg.catalogUrl });
  console.log(`mode=${cfg.mode} dryRun=${dryRun}`);

  try {
    const tenants = await catalog.tenant.findMany({
      where: { deletedAt: null, slug: { not: '_platform' } },
      select: { id: true, slug: true, dbStatus: true, dbConnectionEnc: true },
      orderBy: { createdAt: 'asc' },
    });

    if (cfg.mode === 'pool') {
      // Degenerate case: business data lives in the shared DB.
      const shared = new PrismaClient({ datasourceUrl: cfg.sharedTenantUrl });
      try {
        for (const t of tenants) {
          console.log(`${t.slug}:`);
          await syncTenant(t.slug, t.id, shared, dryRun);
        }
      } finally { await shared.$disconnect(); }
      return;
    }

    const ring = keyRingFromEnv(process.env.TENANT_SECRET_KEYS);
    for (const t of tenants) {
      console.log(`${t.slug}:`);
      if (t.dbStatus !== 'READY' || !t.dbConnectionEnc) {
        console.warn(`  ! skipped (dbStatus=${t.dbStatus}, secret=${t.dbConnectionEnc ? 'present' : 'missing'})`);
        continue;
      }
      const db = new PrismaClient({ datasourceUrl: decryptSecret(t.dbConnectionEnc, ring) });
      try {
        await syncTenant(t.slug, t.id, db, dryRun);
      } finally {
        await db.$disconnect();
      }
    }
  } finally {
    await catalog.$disconnect();
  }
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
