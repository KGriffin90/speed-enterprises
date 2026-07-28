import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { CatalogPrismaService } from './catalog-prisma.service';
import { TenantDatabaseService } from './tenant-database.service';
import { loadTenancyConfig, TenancyConfig } from './tenancy.config';
import { encryptSecret, keyRingFromEnv, KeyRing } from './connection-secret';
import {
  tenantDbName, tenantRoleName, randomPassword, buildTenantUrl,
  createRoleAndDatabase, prepareTenantSchema, runMigrateDeploy, finalizeTenantDb,
  apiPackageDir, withDatabase,
} from './provisioning-sql';

/**
 * Provisions (and de-provisions) a tenant's dedicated database.
 *
 * Lifecycle for a new tenant:
 *   1. Derive a safe database name from the slug.
 *   2. CREATE DATABASE on the admin connection (cannot run inside a tx).
 *   3. `prisma migrate deploy` against the fresh database → identical schema.
 *   4. Encrypt the tenant connection string and persist it on the Tenant row,
 *      flipping dbStatus NONE → PROVISIONING → READY.
 *
 * Idempotency & failure handling matter here: provisioning is a multi-step
 * side-effecting operation that can die halfway (network blip, migration
 * failure). We persist dbStatus at each step so a retry can resume, and we
 * never mark READY until migrations have actually succeeded — a half-migrated
 * database that serves traffic is worse than one that 503s.
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);
  private readonly cfg: TenancyConfig;
  private _keyRing: KeyRing | null = null;

  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly tenantDb: TenantDatabaseService,
  ) {
    this.cfg = loadTenancyConfig();
  }

  /**
   * Encryption key ring, built lazily on first use.
   *
   * This service is instantiated at boot in EVERY mode, but TENANT_SECRET_KEYS
   * is only required when actually provisioning a tenant database (db-per-tenant
   * mode). Building the ring in the constructor would crash a perfectly valid
   * pool-mode app at startup. Resolving it here fails — precisely and only — at
   * the moment provisioning needs it.
   */
  private get keyRing(): KeyRing {
    return (this._keyRing ??= keyRingFromEnv(process.env.TENANT_SECRET_KEYS));
  }

  /**
   * Provision the database for an already-created Tenant row. Safe to retry.
   */
  async provision(tenantId: string): Promise<void> {
    if (this.cfg.mode !== 'db-per-tenant') {
      // Pool mode: nothing to provision; the shared DB already has the schema.
      return;
    }

    const tenant = await this.catalog.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, industry: true, status: true, planTier: true, dbName: true, dbStatus: true },
    });
    if (!tenant) throw new BadRequestException(`Tenant ${tenantId} does not exist.`);
    if (tenant.dbStatus === 'READY') {
      this.logger.warn(`Tenant ${tenant.slug} already provisioned; skipping.`);
      return;
    }

    const dbName   = tenant.dbName ?? tenantDbName(tenant.slug);
    const role     = tenantRoleName(tenant.slug);
    const password = randomPassword();
    const connectionUrl = buildTenantUrl(this.cfg.tenantUrlTemplate!, { user: role, pw: password, db: dbName });

    await this.catalog.tenant.update({
      where: { id: tenantId },
      data: { dbName, dbStatus: 'PROVISIONING' },
    });

    try {
      // 1. Dedicated role + database it owns, with connect locked to that role.
      const admin = this.adminClient();
      try {
        await admin.connect();
        await createRoleAndDatabase(admin, { role, password, dbName });
      } finally {
        await admin.end();
      }

      // 2. Hand the public schema to the tenant role so it can create tables.
      const adminOnTenant = this.clientForUrl(withDatabase(this.cfg.provisioningAdminUrl!, dbName));
      try {
        await adminOnTenant.connect();
        await prepareTenantSchema(adminOnTenant, role);
      } finally {
        await adminOnTenant.end();
      }

      // 3. Apply the schema, then strip cross-DB FKs and seed the self Tenant row.
      await runMigrateDeploy(connectionUrl, apiPackageDir(__dirname));
      const tenantClient = this.clientForUrl(connectionUrl);
      try {
        await tenantClient.connect();
        await finalizeTenantDb(tenantClient, {
          id: tenant.id, slug: tenant.slug,
          industry: tenant.industry, status: tenant.status, planTier: tenant.planTier,
        });
      } finally {
        await tenantClient.end();
      }

      // 3. Persist the ENCRYPTED, per-tenant connection string in the catalog.
      await this.catalog.tenant.update({
        where: { id: tenantId },
        data: {
          dbConnectionEnc: encryptSecret(connectionUrl, this.keyRing),
          dbStatus: 'READY',
          dbProvisionedAt: new Date(),
        },
      });
      this.logger.log(`Provisioned database "${dbName}" (role "${role}") for tenant ${tenant.slug}`);
    } catch (err) {
      await this.catalog.tenant.update({
        where: { id: tenantId },
        data: { dbStatus: 'FAILED' },
      });
      this.logger.error(`Provisioning failed for tenant ${tenant.slug}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Tear down a tenant's database. DESTRUCTIVE. Caller must have already
   * exported/retained backups per data-retention policy.
   */
  async deprovision(tenantId: string, opts: { dropDatabase: boolean } = { dropDatabase: false }): Promise<void> {
    if (this.cfg.mode !== 'db-per-tenant') return;
    const tenant = await this.catalog.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true, dbName: true },
    });
    if (!tenant?.dbName) return;

    await this.tenantDb.invalidate(tenantId); // close the live pool first

    if (opts.dropDatabase) {
      const pg = this.adminClient();
      try {
        await pg.connect();
        // Terminate stragglers so DROP doesn't block on open sessions.
        await pg.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [tenant.dbName],
        );
        await pg.query(`DROP DATABASE IF EXISTS ${quoteIdent(tenant.dbName)}`);
      } finally {
        await pg.end();
      }
    }

    await this.catalog.tenant.update({
      where: { id: tenantId },
      data: { dbStatus: 'NONE', dbConnectionEnc: null },
    });
    this.logger.warn(`De-provisioned tenant ${tenant.slug} (dropDatabase=${opts.dropDatabase})`);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Short-lived superuser connection used ONLY to CREATE ROLE/DATABASE. */
  private adminClient() {
    if (!this.cfg.provisioningAdminUrl) {
      throw new ConflictException('TENANT_DB_ADMIN_URL is not configured; cannot provision.');
    }
    // require() keeps this optional dependency from breaking builds where
    // provisioning isn't used (e.g. pool-mode-only deployments).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Client } = require('pg');
    return new Client({ connectionString: this.cfg.provisioningAdminUrl });
  }

  /** Short-lived connection to a specific tenant database (for finalize SQL). */
  private clientForUrl(url: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Client } = require('pg');
    return new Client({ connectionString: url });
  }
}

/** Quote a Postgres identifier (double-quote, escape embedded quotes). */
function quoteIdent(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing unsafe database identifier: ${name}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}
