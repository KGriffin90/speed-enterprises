/**
 * Bootstrap db-per-tenant topology locally.
 *
 *   1. Create the catalog database + migrate it.
 *   2. Copy the tenant REGISTRY (control-plane rows only — id/slug/industry/...)
 *      from the current pool DB into the catalog, preserving ids.
 *   3. For each tenant: create a dedicated role + database it owns, migrate the
 *      schema, drop cross-DB FKs + seed the self Tenant row, then store the
 *      ENCRYPTED per-tenant connection string on the catalog Tenant row.
 *
 * Non-destructive and idempotent: safe to re-run. Business data is NOT copied
 * here — that is the Stage 4 re-seed. Run with:
 *
 *   pnpm --filter @speed-enterprises/api exec dotenv -e .env -- tsx scripts/bootstrap-tenant-dbs.ts
 */
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import {
  tenantDbName, tenantRoleName, randomPassword, buildTenantUrl,
  createRoleAndDatabase, prepareTenantSchema, runMigrateDeploy, finalizeTenantDb, withDatabase,
} from '../src/database/provisioning-sql';
import { encryptSecret, keyRingFromEnv } from '../src/database/connection-secret';

const API_DIR = resolve(__dirname, '..');

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

/** Parse host/port + a maintenance DB name out of an admin connection URL. */
function adminMaintenanceUrl(): string {
  return reqEnv('TENANT_DB_ADMIN_URL');
}

/** Connect an admin (superuser) client to the maintenance DB. */
function adminClient(): Client {
  return new Client({ connectionString: adminMaintenanceUrl() });
}

/** Database name embedded in a postgres URL (last path segment, sans query). */
function dbNameFromUrl(url: string): string {
  const m = url.match(/\/([^/?]+)(\?|$)/);
  if (!m) throw new Error(`Cannot parse database name from URL: ${url}`);
  return decodeURIComponent(m[1]!);
}

async function ensureDatabase(admin: Client, dbName: string): Promise<void> {
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    console.log(`  created database ${dbName}`);
  } else {
    console.log(`  database ${dbName} already exists`);
  }
}

async function main() {
  const sourceUrl  = reqEnv('DATABASE_URL');          // current pool DB (source of registry)
  const catalogUrl = reqEnv('CATALOG_DATABASE_URL');  // control-plane DB to create
  const template   = reqEnv('TENANT_DB_URL_TEMPLATE');
  const keyRing    = keyRingFromEnv(reqEnv('TENANT_SECRET_KEYS'));

  console.log('▶ Stage 2: bootstrap db-per-tenant\n');

  // 1) Catalog database + migrate.
  console.log('1) Catalog database');
  const catalogName = dbNameFromUrl(catalogUrl);
  {
    const admin = adminClient();
    await admin.connect();
    try { await ensureDatabase(admin, catalogName); }
    finally { await admin.end(); }
  }
  console.log('   migrating catalog schema…');
  await runMigrateDeploy(catalogUrl, API_DIR);
  console.log('   catalog ready\n');

  // 2) Copy the tenant registry (control-plane only) into the catalog.
  console.log('2) Tenant registry → catalog');
  const source  = new PrismaClient({ datasourceUrl: sourceUrl });
  const catalog = new PrismaClient({ datasourceUrl: catalogUrl });
  let tenants: Array<{ id: string; slug: string; industry: any; status: any; planTier: any; customDomain: string | null }>;
  try {
    tenants = await source.tenant.findMany({
      select: { id: true, slug: true, industry: true, status: true, planTier: true, customDomain: true },
      orderBy: { slug: 'asc' },
    });
    for (const t of tenants) {
      await catalog.tenant.upsert({
        where: { id: t.id },
        create: { id: t.id, slug: t.slug, industry: t.industry, status: t.status, planTier: t.planTier, customDomain: t.customDomain ?? null },
        update: { slug: t.slug, industry: t.industry, status: t.status, planTier: t.planTier },
      });
    }
    console.log(`   registered ${tenants.length} tenants in catalog\n`);
  } finally {
    await source.$disconnect();
  }

  // 3) Provision a dedicated role + database per tenant.
  console.log('3) Per-tenant databases (dedicated role each)');
  const summary: Array<{ tenant: string; db: string; role: string; status: string }> = [];
  try {
    for (const t of tenants) {
      const dbName = tenantDbName(t.slug);
      const role   = tenantRoleName(t.slug);
      const pw     = randomPassword();
      const url    = buildTenantUrl(template, { user: role, pw, db: dbName });

      console.log(`  • ${t.slug}: role+db ${dbName}`);
      const admin = adminClient();
      await admin.connect();
      try { await createRoleAndDatabase(admin, { role, password: pw, dbName }); }
      finally { await admin.end(); }

      // Hand the public schema to the tenant role so it can create its tables.
      const adminOnTenant = new Client({ connectionString: withDatabase(adminMaintenanceUrl(), dbName) });
      await adminOnTenant.connect();
      try { await prepareTenantSchema(adminOnTenant, role); }
      finally { await adminOnTenant.end(); }

      await runMigrateDeploy(url, API_DIR);

      const tenantClient = new Client({ connectionString: url });
      await tenantClient.connect();
      try {
        await finalizeTenantDb(tenantClient, {
          id: t.id, slug: t.slug, industry: String(t.industry), status: String(t.status), planTier: String(t.planTier),
        });
      } finally {
        await tenantClient.end();
      }

      await catalog.tenant.update({
        where: { id: t.id },
        data: {
          dbName,
          dbConnectionEnc: encryptSecret(url, keyRing),
          dbStatus: 'READY',
          dbProvisionedAt: new Date(),
        },
      });
      summary.push({ tenant: t.slug, db: dbName, role, status: 'READY' });
    }
  } finally {
    await catalog.$disconnect();
  }

  console.log('\n✓ Done. Per-tenant databases:');
  for (const s of summary) console.log(`   ${s.status.padEnd(6)} ${s.tenant.padEnd(18)} db=${s.db} role=${s.role}`);
  console.log('\nNote: app still runs in pool mode until TENANCY_MODE=db-per-tenant (Stage 4).');
}

main().catch((err) => {
  console.error('\n✗ Bootstrap failed:', err);
  process.exit(1);
});
