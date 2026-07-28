/**
 * Reseed ONLY the ServiceTemplate catalog (catalog DB) from SERVICE_TEMPLATES.
 * Unlike `db:seed`, this does not touch tenants, so it's safe to run against a
 * live dev DB after adding/editing templates without resetting tenant branding.
 *
 *   pnpm --filter @speed-enterprises/api exec tsx prisma/reseed-templates.ts
 */
import { PrismaClient } from '@prisma/client';
import { SERVICE_TEMPLATES } from './seeds/service-templates';

async function main() {
  const prisma = new PrismaClient();
  try {
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
    const byIndustry = await prisma.serviceTemplate.groupBy({ by: ['industry'], _count: true });
    // eslint-disable-next-line no-console
    console.log(`✓ ${SERVICE_TEMPLATES.length} templates across ${byIndustry.length} industries`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
