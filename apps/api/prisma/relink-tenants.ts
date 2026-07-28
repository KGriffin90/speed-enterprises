/**
 * Disaster recovery: re-link orphaned tenant databases back into the catalog.
 *
 * After a `prisma migrate reset` wiped the catalog (Tenant registry, Users,
 * ServiceTemplates), the per-tenant databases survived with all their business
 * data — but the catalog no longer knows they exist, so the app can't route to
 * them. This rebuilds the catalog `Tenant` registry FROM the surviving tenant
 * DBs (preserving each tenant's original id so all tenantId-scoped data stays
 * linked), rotates each DB's owner-role password, re-encrypts the connection
 * string, and restores the platform-admin login.
 *
 * Safe + idempotent: it only ALTERs role passwords and UPSERTs catalog rows.
 * It never drops or modifies any tenant business data.
 *
 *   pnpm --filter @speed-enterprises/api exec tsx prisma/relink-tenants.ts
 */
import 'dotenv/config';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { loadTenancyConfig } from '../src/database/tenancy.config';
import { keyRingFromEnv, encryptSecret } from '../src/database/connection-secret';
import { buildTenantUrl, withDatabase } from '../src/database/provisioning-sql';

const cfg = loadTenancyConfig();
const keyRing = keyRingFromEnv(process.env.TENANT_SECRET_KEYS);
const catalog = new PrismaClient({ datasourceUrl: cfg.catalogUrl });

const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"';
const adminClient = (db?: string) =>
  new Client({ connectionString: db ? withDatabase(cfg.provisioningAdminUrl!, db) : cfg.provisioningAdminUrl! });

async function main() {
  if (cfg.mode !== 'db-per-tenant') {
    console.error('TENANCY_MODE is not db-per-tenant; nothing to relink.');
    process.exit(1);
  }

  // 1. Every tenant database + its owning role (the role that owns the tables).
  const sup = adminClient();
  await sup.connect();
  let dbs: Array<{ datname: string; owner: string }>;
  try {
    const r = await sup.query(
      "SELECT datname, pg_catalog.pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname LIKE 'tenant_%' ORDER BY datname",
    );
    dbs = r.rows;
  } finally { await sup.end(); }
  console.log(`Found ${dbs.length} tenant databases to re-link.`);

  let relinked = 0, skipped = 0;
  for (const { datname, owner } of dbs) {
    // 2. Read the tenant's own identity row (authoritative — carries the id that
    //    all of its business rows reference).
    const tc = adminClient(datname);
    await tc.connect();
    let self: { id: string; slug: string; industry: string; status: string; planTier: string; createdAt: Date } | undefined;
    try {
      const r = await tc.query('SELECT id, slug, industry, status, "planTier", "createdAt" FROM "Tenant" LIMIT 1');
      self = r.rows[0];
    } finally { await tc.end(); }
    if (!self) { console.warn(`  ! ${datname}: no self Tenant row — skipping`); skipped++; continue; }

    // 3. Rotate the owner role's password (the original was lost with the catalog).
    const password = crypto.randomBytes(24).toString('hex'); // hex = URL- and SQL-safe
    const ac = adminClient();
    await ac.connect();
    try {
      await ac.query(`ALTER ROLE ${ident(owner)} WITH LOGIN PASSWORD '${password}'`);
      await ac.query(`GRANT CONNECT ON DATABASE ${ident(datname)} TO ${ident(owner)}`);
    } finally { await ac.end(); }

    // 4. Build + verify the new connection, then store it (encrypted) in the catalog.
    const connectionUrl = buildTenantUrl(cfg.tenantUrlTemplate!, { user: owner, pw: password, db: datname });
    const test = new PrismaClient({ datasourceUrl: connectionUrl });
    try { await test.$queryRawUnsafe('SELECT 1'); }
    finally { await test.$disconnect(); }

    await catalog.tenant.upsert({
      where: { id: self.id },
      update: {
        slug: self.slug, industry: self.industry as any, status: self.status as any, planTier: self.planTier as any,
        dbName: datname, dbConnectionEnc: encryptSecret(connectionUrl, keyRing), dbStatus: 'READY', dbProvisionedAt: new Date(), deletedAt: null,
      },
      create: {
        id: self.id, slug: self.slug, industry: self.industry as any, status: self.status as any, planTier: self.planTier as any,
        createdAt: self.createdAt ?? undefined,
        dbName: datname, dbConnectionEnc: encryptSecret(connectionUrl, keyRing), dbStatus: 'READY', dbProvisionedAt: new Date(),
      },
    });
    console.log(`  ✓ re-linked ${self.slug} (${datname}, owner=${owner})`);
    relinked++;
  }

  // 5. Restore the platform-admin login (matches the seed defaults).
  const email = process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@speedenterprises.app';
  const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD ?? 'Admin!Platform2026';
  const adminUser = await catalog.user.upsert({
    where: { email },
    update: { platformRole: 'PLATFORM_ADMIN', emailVerifiedAt: new Date() },
    create: { email, passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }), platformRole: 'PLATFORM_ADMIN', emailVerifiedAt: new Date() },
  });
  await catalog.platformAdmin.upsert({
    where: { userId: adminUser.id },
    update: { fullName: 'Platform Admin' },
    create: { userId: adminUser.id, fullName: 'Platform Admin' },
  });

  console.log(`\nDone. re-linked=${relinked} skipped=${skipped}.`);
  console.log(`Platform admin restored: ${email} / ${adminPassword}`);
  await catalog.$disconnect();
}

main().catch(async (e) => { console.error(e); await catalog.$disconnect(); process.exit(1); });
