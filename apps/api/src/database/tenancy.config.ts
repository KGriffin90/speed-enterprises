import { Logger } from '@nestjs/common';

/**
 * Tenancy topology, controlled by a single env var so the cut-over is a flag
 * flip with instant rollback — never a code deploy under pressure.
 *
 *   TENANCY_MODE=pool          → one shared database, row-level tenantId scoping
 *                                (the original design; default; zero risk).
 *   TENANCY_MODE=db-per-tenant → every tenant has its own physical database;
 *                                connections are routed per request.
 *
 * In `pool` mode the "catalog" database and every "tenant" database are the
 * same physical DB (DATABASE_URL). That makes pool mode the degenerate case of
 * db-per-tenant, so the same code paths run in both modes — we don't maintain
 * two divergent implementations.
 */
export type TenancyMode = 'pool' | 'db-per-tenant';

export interface TenancyConfig {
  mode: TenancyMode;
  /** Connection string for the control-plane (catalog) DB: identity + tenant registry. */
  catalogUrl: string;
  /** In pool mode, the single shared business DB. Ignored in db-per-tenant mode. */
  sharedTenantUrl: string;
  /** Max simultaneously-open tenant connection pools (db-per-tenant mode). */
  maxTenantClients: number;
  /** Evict a tenant client after this many ms idle. */
  tenantClientIdleMs: number;
  /**
   * Admin connection used ONLY to CREATE/DROP tenant databases during
   * provisioning. Must be a superuser/owner role. Never used for queries.
   */
  provisioningAdminUrl?: string;
  /**
   * Template for a new tenant's connection string. `{db}` is replaced with the
   * generated database name. Example:
   *   postgresql://tenant_rw:pw@db.internal:5432/{db}?sslmode=require&connection_limit=3
   */
  tenantUrlTemplate?: string;
}

/**
 * Memoized for the real process environment so the config is parsed once and the
 * mode banner is logged once, no matter how many providers call this at boot.
 * Calls with an explicit (test) env are never cached.
 */
let cachedDefault: TenancyConfig | null = null;

export function loadTenancyConfig(env: NodeJS.ProcessEnv = process.env): TenancyConfig {
  const useCache = env === process.env;
  if (useCache && cachedDefault) return cachedDefault;

  const cfg = buildTenancyConfig(env);
  if (useCache) cachedDefault = cfg;
  return cfg;
}

function buildTenancyConfig(env: NodeJS.ProcessEnv): TenancyConfig {
  const mode = (env.TENANCY_MODE ?? 'pool').toLowerCase() as TenancyMode;
  if (mode !== 'pool' && mode !== 'db-per-tenant') {
    throw new Error(`Invalid TENANCY_MODE "${env.TENANCY_MODE}". Use "pool" or "db-per-tenant".`);
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  // In pool mode the catalog IS the shared DB. In db-per-tenant mode you should
  // point CATALOG_DATABASE_URL at a dedicated control-plane database, but we
  // fall back to DATABASE_URL so a half-configured prod doesn't silently route
  // tenant identity somewhere unexpected.
  const catalogUrl = env.CATALOG_DATABASE_URL ?? databaseUrl;

  const cfg: TenancyConfig = {
    mode,
    catalogUrl,
    sharedTenantUrl: databaseUrl,
    maxTenantClients: intEnv(env.TENANT_MAX_CLIENTS, 50),
    tenantClientIdleMs: intEnv(env.TENANT_CLIENT_IDLE_MS, 5 * 60_000),
    provisioningAdminUrl: env.TENANT_DB_ADMIN_URL,
    tenantUrlTemplate: env.TENANT_DB_URL_TEMPLATE,
  };

  if (mode === 'db-per-tenant') {
    const missing: string[] = [];
    if (!env.CATALOG_DATABASE_URL) missing.push('CATALOG_DATABASE_URL');
    if (!cfg.provisioningAdminUrl) missing.push('TENANT_DB_ADMIN_URL');
    if (!cfg.tenantUrlTemplate) missing.push('TENANT_DB_URL_TEMPLATE');
    if (!env.TENANT_SECRET_KEYS) missing.push('TENANT_SECRET_KEYS');
    if (missing.length) {
      // Loud failure at boot beats a silent misroute at runtime.
      throw new Error(
        `TENANCY_MODE=db-per-tenant requires: ${missing.join(', ')}. ` +
          'Refusing to start to avoid routing tenant data to the wrong database.',
      );
    }
  } else {
    new Logger('Tenancy').warn(
      'TENANCY_MODE=pool — single shared database with row-level isolation. ' +
        'Set TENANCY_MODE=db-per-tenant for physical per-tenant databases.',
    );
  }

  return cfg;
}

function intEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
