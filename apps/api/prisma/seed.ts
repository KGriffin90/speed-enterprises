/**
 * Top-level seed orchestrator. Run with: pnpm --filter @speed-enterprises/api db:seed
 *
 * Order:
 *   1. Platform-level: ServiceTemplate catalog + the synthetic `_platform` tenant.
 *   2. PlatformAdmin user (you).
 *   3. Speed Enterprises (window cleaning) — the tenant.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SERVICE_TEMPLATES } from './seeds/service-templates';
import { seedSpeedEnterprises } from './seeds/speed-enterprises';
import {
  BrandingSchema, ContactSchema, SchedulingSchema, AutomationSchema, AISchema,
  PaymentsSchema, FeaturesSchema, DEFAULT_OPERATING_HOURS,
} from '@speed-enterprises/shared';
import { loadTenancyConfig } from '../src/database/tenancy.config';

async function main() {
  // These seeds write business rows (TenantConfig, Service, quotes) through a
  // single PrismaClient — valid only in pool mode where catalog and tenant
  // data share one database. After the db-per-tenant cut-over that data lives
  // in per-tenant databases, so fail fast with directions instead of crashing
  // halfway through with a confusing P2025.
  if (loadTenancyConfig().mode === 'db-per-tenant') {
    console.error(
      'TENANCY_MODE=db-per-tenant: the dev seeds only support pool mode.\n' +
      'For schema changes run:  pnpm --filter @speed-enterprises/api db:migrate-tenants\n' +
      'For data updates run:    pnpm --filter @speed-enterprises/api db:sync-tenant-data\n' +
      '(Or set TENANCY_MODE=pool in apps/api/.env if this environment should be pool-mode.)',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    // ── ServiceTemplate catalog ───────────────────────────────────────────
    // eslint-disable-next-line no-console
    console.log('Seeding service templates…');
    await prisma.serviceTemplate.deleteMany({});
    for (const t of SERVICE_TEMPLATES) {
      await prisma.serviceTemplate.create({
        data: {
          industry: t.industry,
          name: t.name,
          description: t.description,
          category: t.category,
          iconKey: t.iconKey,
          recommendedBasePriceCents: t.recommendedBasePriceCents,
          pricingMode: t.pricingMode,
          questions: t.questions as any,
          pricingRules: t.pricingRules as any,
          lineItemKinds: t.lineItemKinds,
          capabilities: t.capabilities,
          estimatedDurationMinutes: t.estimatedDurationMinutes ?? null,
          sortOrder: t.sortOrder,
        },
      });
    }
    console.log(`✓ ${SERVICE_TEMPLATES.length} service templates seeded`);

    // ── Synthetic platform tenant (for platform-level email logs) ─────────
    const platformTenantSlug = '_platform';
    let platformTenant = await prisma.tenant.findUnique({ where: { slug: platformTenantSlug } });
    if (!platformTenant) {
      platformTenant = await prisma.tenant.create({
        data: {
          slug: platformTenantSlug,
          industry: 'OTHER',
          status: 'ACTIVE',
          planTier: 'ENTERPRISE',
          config: {
            create: {
              businessName: process.env.PLATFORM_NAME ?? 'Speed Enterprises',
              legalName:    process.env.PLATFORM_NAME ?? 'Speed Enterprises',
              branding:   BrandingSchema.parse({
                logoUrl:     'https://api.dicebear.com/9.x/initials/svg?seed=TP&backgroundColor=111827&textColor=ffffff',
                faviconUrl:  'https://api.dicebear.com/9.x/initials/svg?seed=TP&backgroundColor=111827&textColor=ffffff&size=64',
                appIconUrl:  'https://api.dicebear.com/9.x/initials/svg?seed=TP&backgroundColor=111827&textColor=ffffff&size=512',
                wordmarkText: 'Speed Enterprises',
                colors: {
                  brand50:'#f9fafb', brand100:'#f3f4f6', brand200:'#e5e7eb',
                  brand400:'#9ca3af', brand500:'#374151', brand600:'#1f2937',
                  brand700:'#111827', brand900:'#030712',
                  accent:'#22d3ee', onBrand:'#ffffff',
                },
              }) as any,
              contact: ContactSchema.parse({
                publicPhone: '(000) 000-0000',
                publicEmail: process.env.PLATFORM_SUPPORT_EMAIL ?? 'support@example.com',
                notificationEmails: [process.env.PLATFORM_SUPPORT_EMAIL ?? 'support@example.com'],
                address: { state: 'CA', postalCode: '00000' },
                serviceAreas: [{ label: 'Platform' }],
              }) as any,
              scheduling: SchedulingSchema.parse({ timezone: 'UTC', operatingHours: DEFAULT_OPERATING_HOURS }) as any,
              automation: AutomationSchema.parse({}) as any,
              ai:         AISchema.parse({}) as any,
              payments:   PaymentsSchema.parse({}) as any,
              features:   FeaturesSchema.parse({ residentialEnabled: false, commercialEnabled: false, publicQuoteFormEnabled: false }) as any,
            },
          },
        },
      });
    }
    process.env.PLATFORM_TENANT_ID = platformTenant.id;
    console.log(`✓ Platform tenant ready (id=${platformTenant.id})`);

    // ── Platform admin user ───────────────────────────────────────────────
    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@speedenterprises.app';
    const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD ?? 'Admin!Platform2026';
    let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
          platformRole: 'PLATFORM_ADMIN',
          emailVerifiedAt: new Date(),
        },
      });
    } else if (admin.platformRole !== 'PLATFORM_ADMIN') {
      await prisma.user.update({ where: { id: admin.id }, data: { platformRole: 'PLATFORM_ADMIN' } });
    }
    await prisma.platformAdmin.upsert({
      where:  { userId: admin.id },
      create: { userId: admin.id, fullName: 'Platform Admin' },
      update: {},
    });
    console.log(`✓ Platform admin: ${adminEmail} / ${adminPassword}`);

    // ── Example tenants ───────────────────────────────────────────────────
    await seedSpeedEnterprises(prisma);

    console.log('\nAll done. Try:');
    console.log(`  curl http://localhost:4000/api/config/speedenterprises | jq`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
