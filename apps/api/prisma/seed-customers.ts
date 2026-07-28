/**
 * Adds 20 fake customers to the Speed Enterprises tenant for testing: a catalog
 * User + CUSTOMER TenantMembership (so they can sign in) + a CustomerProfile with
 * name, phone and a Salt Lake City-area address. Idempotent by email, so re-runs
 * update rather than duplicate.
 *
 *   pnpm --filter @speed-enterprises/api db:seed-customers
 *
 * Standalone and opt-in — it is NOT called by the default `pnpm seed`, which
 * stays owner-only. All accounts share the password below and use @example.com
 * (a reserved, obviously-fake domain) so they are easy to spot and remove.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const TENANT_SLUG = 'speedenterprises';
const PASSWORD = 'Customer!2026';

const NAMES: Array<[string, string]> = [
  ['Sarah', 'Mitchell'], ['James', 'Kowalski'], ['Emily', 'Tran'],
  ['Marcus', 'Johnson'], ['Olivia', 'Hernandez'], ['Derek', 'Patel'],
  ['Brittany', 'Nguyen'], ['Carson', 'Williams'], ['Aaliyah', 'Brooks'],
  ['Tyler', 'Sorensen'], ['Morgan', 'Castillo'], ['Zoe', 'Andersen'],
  ['Ethan', 'Reyes'], ['Chloe', 'Bennett'], ['Nathan', 'Foster'],
  ['Grace', 'Murphy'], ['Lucas', 'Rivera'], ['Hannah', 'Coleman'],
  ['Owen', 'Sullivan'], ['Isabella', 'Vance'],
];

const ADDRESSES: Array<{ line: string; city: string; state: string; zip: string }> = [
  { line: '142 E 900 S',          city: 'Salt Lake City',    state: 'UT', zip: '84102' },
  { line: '375 W 200 N',          city: 'Murray',            state: 'UT', zip: '84107' },
  { line: '8800 S Highland Dr',   city: 'Sandy',             state: 'UT', zip: '84093' },
  { line: '1455 W 9000 S',        city: 'West Jordan',       state: 'UT', zip: '84088' },
  { line: '10600 S 1300 E',       city: 'Draper',            state: 'UT', zip: '84020' },
  { line: '900 E Winchester St',  city: 'Murray',            state: 'UT', zip: '84107' },
  { line: '2340 S 700 E',         city: 'Salt Lake City',    state: 'UT', zip: '84106' },
  { line: '455 N Redwood Rd',     city: 'Salt Lake City',    state: 'UT', zip: '84116' },
  { line: '6550 S Cottonwood St', city: 'Midvale',           state: 'UT', zip: '84047' },
  { line: '3600 Constitution Blvd', city: 'West Valley City', state: 'UT', zip: '84119' },
  { line: '12300 S Lone Peak Pkwy', city: 'Draper',          state: 'UT', zip: '84020' },
  { line: '500 W 100 S',          city: 'Salt Lake City',    state: 'UT', zip: '84101' },
  { line: '1780 E 4500 S',        city: 'Holladay',          state: 'UT', zip: '84117' },
  { line: '9200 S Redwood Rd',    city: 'West Jordan',       state: 'UT', zip: '84088' },
  { line: '3300 S State St',      city: 'South Salt Lake',   state: 'UT', zip: '84115' },
  { line: '11400 S 4000 W',       city: 'South Jordan',      state: 'UT', zip: '84009' },
  { line: '2100 E Sunnyside Ave', city: 'Salt Lake City',    state: 'UT', zip: '84108' },
  { line: '7200 S 900 E',         city: 'Midvale',           state: 'UT', zip: '84047' },
  { line: '4801 W 6200 S',        city: 'Kearns',            state: 'UT', zip: '84118' },
  { line: '1355 E Murray Holladay Rd', city: 'Holladay',     state: 'UT', zip: '84117' },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) { console.error(`Tenant '${TENANT_SLUG}' not found — run the base seed first.`); process.exit(1); }

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  for (let i = 0; i < NAMES.length; i++) {
    const [first, last] = NAMES[i]!;
    const addr = ADDRESSES[i % ADDRESSES.length]!;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;
    const fullName = `${first} ${last}`;
    const phone = `(801) 555-${String(1000 + i).padStart(4, '0')}`;

    const user = await prisma.user.upsert({
      where:  { email },
      create: { email, passwordHash, platformRole: 'CUSTOMER', emailVerifiedAt: new Date() },
      update: {},
    });
    await prisma.tenantMembership.upsert({
      where:  { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
      create: { userId: user.id, tenantId: tenant.id, role: 'CUSTOMER', fullName, acceptedAt: new Date() },
      update: { role: 'CUSTOMER', active: true, fullName },
    });
    await prisma.customerProfile.upsert({
      where:  { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
      create: {
        userId: user.id, tenantId: tenant.id, fullName, phone,
        addressLine: addr.line, city: addr.city, state: addr.state, postalCode: addr.zip,
      },
      update: { fullName, phone, addressLine: addr.line, city: addr.city, state: addr.state, postalCode: addr.zip },
    });
  }

  console.log(`✓ Seeded ${NAMES.length} fake customers on '${TENANT_SLUG}' (password: ${PASSWORD}, domain: @example.com)`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
