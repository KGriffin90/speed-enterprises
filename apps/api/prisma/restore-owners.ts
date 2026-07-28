/**
 * Restore a DISTINCT owner login per tenant in the catalog (User + OWNER
 * TenantMembership). The reset wiped all users/memberships; this rebuilds them.
 *
 * The four original tenants use the exact credentials defined in their seed
 * files (seeds/*.ts). Every other (demo) tenant gets a distinct generated
 * login: owner@<slug>.example. Idempotent (upserts).
 *
 *   pnpm --filter @speed-enterprises/api exec tsx prisma/restore-owners.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { loadTenancyConfig } from '../src/database/tenancy.config';

const cfg = loadTenancyConfig();
const catalog = new PrismaClient({ datasourceUrl: cfg.catalogUrl });

// Exact owner credentials lifted from the dedicated seed files (seeds/*.ts).
const SEED_OWNERS: Record<string, { email: string; password: string; name: string }> = {
  speedenterprises: { email: 'owner@speedenterprises.com', password: 'Speed!Owner2026',    name: 'Speed Enterprises Owner' },
  'acme-plumbing':  { email: 'owner@acmeplumbing.example', password: 'Acme!Owner2026',     name: 'Acme Owner' },
  'es-solar':       { email: 'owner@essolar.example',      password: 'Solar!Owner2026',    name: 'ES Solar Owner' },
  'hunt-electric':  { email: 'owner@huntelectric.com',     password: 'Electric!Owner2026', name: 'Hunt Electric Owner' },
};
const DEMO_PASSWORD = 'Owner!Demo2026';

const pretty = (slug: string) =>
  slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

async function main() {
  const tenants = await catalog.tenant.findMany({
    where: { deletedAt: null, slug: { not: '_platform' } },
    select: { id: true, slug: true },
    orderBy: { slug: 'asc' },
  });

  const out: Array<{ business: string; ownerEmail: string; password: string }> = [];
  for (const t of tenants) {
    const spec = SEED_OWNERS[t.slug] ?? {
      email: `owner@${t.slug}.example`,
      password: DEMO_PASSWORD,
      name: `${pretty(t.slug)} Owner`,
    };

    const user = await catalog.user.upsert({
      where: { email: spec.email },
      update: { emailVerifiedAt: new Date() },
      create: {
        email: spec.email,
        passwordHash: await argon2.hash(spec.password, { type: argon2.argon2id }),
        platformRole: 'CUSTOMER',
        emailVerifiedAt: new Date(),
      },
    });

    await catalog.tenantMembership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId: t.id } },
      update: { role: 'OWNER', active: true, fullName: spec.name },
      create: { userId: user.id, tenantId: t.id, role: 'OWNER', fullName: spec.name, acceptedAt: new Date() },
    });

    out.push({ business: t.slug, ownerEmail: spec.email, password: spec.password });
  }

  console.table(out);
  console.log(`\nRestored ${out.length} distinct tenant owners.`);
  await catalog.$disconnect();
}

main().catch(async (e) => { console.error(e); await catalog.$disconnect(); process.exit(1); });
