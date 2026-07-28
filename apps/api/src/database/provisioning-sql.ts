import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Client } from 'pg';

const execFileAsync = promisify(execFile);

/**
 * Pure, DI-free building blocks for standing up a tenant's dedicated database
 * with its OWN role/credentials. Shared by the runtime TenantProvisioningService
 * and the one-off bootstrap script so the two never drift.
 *
 * Topology produced per tenant:
 *   role     tenant_<slug>   (LOGIN, owns only its own database)
 *   database tenant_<slug>   (OWNER = the role above)
 * The encrypted connection string for that role lives in the catalog's Tenant
 * row; nothing else can read the tenant's data.
 */

/** `acme-window-co` → `acme_window_co` (Postgres identifier-safe, no leading/trailing _). */
function safeSlug(slug: string): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!safe) throw new Error(`Cannot derive an identifier from slug "${slug}".`);
  return safe;
}

export function tenantDbName(slug: string): string {
  return `tenant_${safeSlug(slug)}`.slice(0, 63);
}

export function tenantRoleName(slug: string): string {
  return `tenant_${safeSlug(slug)}`.slice(0, 63);
}

/** A strong, URL-safe password (no characters that need escaping in a URL). */
export function randomPassword(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Build the tenant connection string from a template. The template may contain
 * `{user}`, `{pw}`, and `{db}` placeholders, e.g.
 *   postgresql://{user}:{pw}@localhost:5433/{db}?schema=public
 */
export function buildTenantUrl(
  template: string,
  parts: { user: string; pw: string; db: string },
): string {
  if (!template.includes('{db}')) {
    throw new Error('TENANT_DB_URL_TEMPLATE must contain the "{db}" placeholder.');
  }
  return template
    .replace('{user}', parts.user)
    .replace('{pw}', encodeURIComponent(parts.pw))
    .replace('{db}', parts.db);
}

/** Quote a Postgres identifier; refuse anything that isn't a plain identifier. */
export function quoteIdent(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Create (idempotently) a dedicated login role and a database it owns.
 * `admin` must be a superuser connection to a maintenance DB (e.g. `postgres`).
 * Neither CREATE ROLE nor CREATE DATABASE can run inside a transaction.
 */
export async function createRoleAndDatabase(
  admin: Client,
  opts: { role: string; password: string; dbName: string },
): Promise<void> {
  const { role, password, dbName } = opts;

  // Role: create if missing, then (re)set the password so creds are known.
  const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (!roleExists.rowCount) {
    await admin.query(`CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD ${literal(password)}`);
  } else {
    await admin.query(`ALTER ROLE ${quoteIdent(role)} WITH LOGIN PASSWORD ${literal(password)}`);
  }

  // Database owned by the role.
  const dbExists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!dbExists.rowCount) {
    await admin.query(`CREATE DATABASE ${quoteIdent(dbName)} OWNER ${quoteIdent(role)}`);
  }

  // CREDENTIAL ISOLATION: Postgres grants CONNECT to PUBLIC on every database by
  // default, so without this any tenant role could connect to any tenant DB.
  // Lock connect access down to this tenant's role only.
  await admin.query(`REVOKE CONNECT ON DATABASE ${quoteIdent(dbName)} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(role)}`);
}

/**
 * Make the tenant role own the `public` schema of its database so it can create
 * tables (PG15+ no longer grants CREATE on public to non-owners). Run against an
 * admin (superuser) connection to the TENANT'S database, before schema sync.
 */
export async function prepareTenantSchema(adminOnTenant: Client, role: string): Promise<void> {
  await adminOnTenant.query(`ALTER SCHEMA public OWNER TO ${quoteIdent(role)}`);
}

/** Swap the database name in a Postgres connection URL (keeps creds/host/params). */
export function withDatabase(url: string, dbName: string): string {
  return url.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
}

/** Apply committed migrations against a database. Never `migrate dev`. (prod path) */
export async function runMigrateDeploy(connectionUrl: string, apiDir: string): Promise<void> {
  await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: connectionUrl },
    timeout: 180_000,
  });
}

export interface TenantSelfRow {
  id: string;
  slug: string;
  industry: string;
  status: string;
  planTier: string;
}

/**
 * After the schema is migrated, make a tenant database safe for single-tenant,
 * cross-DB-identity operation:
 *   1. Drop every FK that references `User` or `TenantMembership` — those rows
 *      live in the catalog, so the constraint can never be satisfied here.
 *   2. Insert the tenant's own `Tenant` row (id MUST match the catalog) so the
 *      intra-DB `tenantId → Tenant` foreign keys resolve when business data is
 *      written.
 * `tenantClient` is a connection to the tenant's own database (admin or owner).
 */
export async function finalizeTenantDb(tenantClient: Client, self: TenantSelfRow): Promise<void> {
  // 1. Drop cross-DB FK constraints (to catalog-only identity tables).
  await tenantClient.query(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT con.conname, cl.relname AS table_name
        FROM pg_constraint con
        JOIN pg_class cl  ON cl.oid  = con.conrelid
        JOIN pg_class ref ON ref.oid = con.confrelid
        WHERE con.contype = 'f' AND ref.relname IN ('User', 'TenantMembership')
      LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.table_name, r.conname);
      END LOOP;
    END $$;
  `);

  // 2. Seed the self Tenant row (id matches catalog) so tenantId FKs resolve.
  await tenantClient.query(
    `INSERT INTO "Tenant" (id, slug, industry, status, "planTier", "createdAt", "updatedAt")
     VALUES ($1, $2, $3::"Industry", $4::"TenantStatus", $5::"PlanTier", now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [self.id, self.slug, self.industry, self.status, self.planTier],
  );
}

/** Postgres string literal (single-quote, escape embedded quotes). For passwords. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Where the api package lives, for running prisma from a compiled or ts context. */
export function apiPackageDir(fromDir: string): string {
  // src/database → apps/api ; dist/database → apps/api
  return join(fromDir, '..', '..');
}
