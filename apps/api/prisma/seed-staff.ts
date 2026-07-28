/**
 * Add two DISTINCT staff members to every tenant: a catalog User + STAFF
 * TenantMembership (so they can log into that tenant), plus an EmployeeProfile
 * (pay rate / MPG / vehicle) in the tenant's own DB so they work for timesheets
 * and route gas estimates. 24 tenants × 2 = 48 unique staff, no overlap.
 *
 *   pnpm --filter @speed-enterprises/api exec tsx prisma/seed-staff.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { loadTenancyConfig } from '../src/database/tenancy.config';

const cfg = loadTenancyConfig();
const catalog = new PrismaClient({ datasourceUrl: cfg.catalogUrl });

// 24 firsts × 24 lasts, paired so every staff slot (0..47) is a unique person.
const FIRSTS = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Cameron', 'Drew', 'Skyler', 'Reese', 'Hayden', 'Emerson', 'Rowan', 'Parker', 'Sawyer', 'Finley', 'Harper', 'Kendall', 'Logan', 'Peyton', 'Dakota'];
const LASTS = ['Reyes', 'Lee', 'Kim', 'Nguyen', 'Patel', 'Garcia', 'Brooks', 'Hayes', 'Foster', 'Bennett', 'Coleman', 'Rivera', 'Sullivan', 'Murphy', 'Ramsey', 'Donovan', 'Vance', 'Ellis', 'Mercer', 'Carver', 'Hale', 'Bishop', 'Cross', 'Nash'];
const N = 24;
function person(k: number): { first: string; last: string; name: string } {
  const first = FIRSTS[k % N]!;
  const last = LASTS[(k + Math.floor(k / N)) % N]!; // second pass shifts the last name → still unique
  return { first, last, name: `${first} ${last}` };
}

const PASSWORD = 'Staff!Demo2026';
const VEHICLES = ['2021 Honda CR-V', '2019 Toyota Tacoma', '2022 Ford Maverick', '2020 Chevy Silverado', '2023 Ford Transit', '2018 Ram 1500'];

async function main() {
  const tenants = await catalog.tenant.findMany({
    where: { deletedAt: null, slug: { not: '_platform' } },
    select: { id: true, slug: true, dbName: true },
    orderBy: { slug: 'asc' },
  });

  const out: Array<{ business: string; staff: string; email: string }> = [];
  for (let i = 0; i < tenants.length; i++) {
    const t = tenants[i]!;
    const tdb = new PrismaClient({ datasourceUrl: `postgresql://postgres:postgres@localhost:5433/${t.dbName}` });
    try {
      for (let s = 0; s < 2; s++) {
        const idx = 2 * i + s;
        const p = person(idx);
        const email = `${p.first}.${p.last}@${t.slug}.example`.toLowerCase();

        const user = await catalog.user.upsert({
          where: { email },
          update: { emailVerifiedAt: new Date() },
          create: { email, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), platformRole: 'CUSTOMER', emailVerifiedAt: new Date() },
        });

        const m = await catalog.tenantMembership.upsert({
          where: { userId_tenantId: { userId: user.id, tenantId: t.id } },
          update: { role: 'STAFF', active: true, fullName: p.name },
          create: { userId: user.id, tenantId: t.id, role: 'STAFF', fullName: p.name, acceptedAt: new Date() },
        });

        await tdb.employeeProfile.upsert({
          where: { membershipId: m.id },
          update: { payType: 'HOURLY' },
          create: {
            membershipId: m.id,
            basePayCents: 1900 + s * 250,
            payType: 'HOURLY',
            avgMpg: 24 + (idx % 7),
            vehicleNotes: VEHICLES[idx % VEHICLES.length]!,
            phone: `(801) 555-${String(2000 + idx).slice(-4)}`,
          },
        });

        out.push({ business: t.slug, staff: p.name, email });
      }
    } finally { await tdb.$disconnect(); }
  }

  console.table(out);
  console.log(`\nAdded ${out.length} staff across ${tenants.length} tenants. Password for all: ${PASSWORD}`);
  await catalog.$disconnect();
}

main().catch(async (e) => { console.error(e); await catalog.$disconnect(); process.exit(1); });
