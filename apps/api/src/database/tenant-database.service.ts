import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogPrismaService } from './catalog-prisma.service';
import { TenantConnectionRegistry } from './tenant-connection.registry';
import { loadTenancyConfig, TenancyConfig } from './tenancy.config';
import { decryptSecret, keyRingFromEnv, KeyRing } from './connection-secret';

/**
 * Resolves the correct PrismaClient for a tenant and owns the lifecycle of all
 * per-tenant connection pools.
 *
 *   pool mode          → returns the single shared PrismaService (one pool).
 *   db-per-tenant mode → looks up the tenant's encrypted connection string in
 *                        the catalog, decrypts it, and hands back a cached,
 *                        per-tenant PrismaClient via the LRU registry.
 *
 * This is the ONLY place that turns a tenantId into a database handle. Every
 * request-scoped query for tenant business data goes through here, which is
 * exactly what makes "no tenant can ever touch another tenant's database" a
 * single, auditable invariant rather than a property scattered across 30
 * services.
 */
/**
 * Bound each per-tenant connection pool. With db-per-tenant we may keep dozens
 * of tenant clients warm at once, and Postgres only has ~100 connection slots;
 * an unbounded default pool (num_cpus*2+1 ≈ 5) per tenant exhausts them fast
 * ("remaining connection slots are reserved for roles with the SUPERUSER
 * attribute"). We cap each tenant's pool so total = tenants × limit stays well
 * under max_connections. An explicit value already in the connection string
 * always wins — we only fill in the default when it's absent.
 */
export function withPoolDefaults(url: string): string {
  const limit = intFromEnv(process.env.TENANT_DB_CONNECTION_LIMIT, 3);
  const poolTimeout = intFromEnv(process.env.TENANT_DB_POOL_TIMEOUT, 10);
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', String(limit));
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', String(poolTimeout));
    return u.toString();
  } catch {
    // Non-parseable URL (shouldn't happen): fall back to a string append.
    const sep = url.includes('?') ? '&' : '?';
    return url.includes('connection_limit=') ? url : `${url}${sep}connection_limit=${limit}&pool_timeout=${poolTimeout}`;
  }
}

function intFromEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

@Injectable()
export class TenantDatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TenantDatabaseService.name);
  private readonly cfg: TenancyConfig;
  private readonly keyRing: KeyRing | null;
  private readonly registry: TenantConnectionRegistry<PrismaClient>;
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly shared: PrismaService,
    private readonly catalog: CatalogPrismaService,
  ) {
    this.cfg = loadTenancyConfig();
    // Key ring only required in db-per-tenant mode (validated at config load).
    this.keyRing = this.cfg.mode === 'db-per-tenant' ? keyRingFromEnv(process.env.TENANT_SECRET_KEYS) : null;

    this.registry = new TenantConnectionRegistry<PrismaClient>({
      maxClients: this.cfg.maxTenantClients,
      idleTtlMs: this.cfg.tenantClientIdleMs,
      onEvict: (tenantId, reason) =>
        this.logger.debug(`tenant client evicted [${reason}] tenant=${tenantId} live=${this.registry.size}`),
      factory: (url) =>
        new PrismaClient({
          datasourceUrl: withPoolDefaults(url),
          errorFormat: 'minimal',
          log:
            process.env.NODE_ENV === 'production'
              ? [{ emit: 'event', level: 'error' }]
              : [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }],
        }),
    });
  }

  onModuleInit() {
    if (this.cfg.mode === 'db-per-tenant' && this.cfg.tenantClientIdleMs > 0) {
      // Sweep idle pools so cold tenants don't hold Postgres connections.
      this.sweepTimer = setInterval(() => {
        void this.registry.sweepIdle();
      }, Math.min(this.cfg.tenantClientIdleMs, 60_000));
      this.sweepTimer.unref?.();
    }
  }

  async onApplicationShutdown() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.registry.shutdown();
  }

  /**
   * The database client for `tenantId`. Throws (never falls back to another
   * tenant's DB) if the tenant is unknown or hasn't been provisioned.
   */
  async clientFor(tenantId: string): Promise<PrismaClient> {
    if (this.cfg.mode === 'pool') {
      // One shared database; row-level scoping handles isolation.
      return this.shared;
    }
    return this.registry.acquire(tenantId, () => this.resolveUrl(tenantId));
  }

  /** Drop a tenant's pooled connection (call after suspend / credential rotation). */
  async invalidate(tenantId: string): Promise<void> {
    await this.registry.invalidate(tenantId);
  }

  get liveConnectionCount(): number {
    return this.registry.size;
  }

  /** Look up + decrypt a tenant's dedicated connection string from the catalog. */
  private async resolveUrl(tenantId: string): Promise<string> {
    const tenant = await this.catalog.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, status: true, dbConnectionEnc: true, dbStatus: true },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found in catalog.`);
    }
    if (!tenant.dbConnectionEnc || tenant.dbStatus !== 'READY') {
      // Provisioning incomplete — fail closed rather than guess a database.
      throw new ServiceUnavailableException(
        `Tenant ${tenant.slug} database is not ready (status=${tenant.dbStatus ?? 'NONE'}).`,
      );
    }

    try {
      return decryptSecret(tenant.dbConnectionEnc, this.keyRing!);
    } catch (err) {
      // A decrypt failure here is a security-relevant event (key mismatch or
      // tampering). Surface it loudly; do not connect to anything.
      this.logger.error(`Failed to decrypt connection secret for tenant ${tenant.slug}: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Tenant database credentials unavailable.');
    }
  }
}
