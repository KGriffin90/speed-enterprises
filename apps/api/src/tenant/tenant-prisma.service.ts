import { Inject, Injectable, Scope, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { TenantContext } from './tenant-context';

/**
 * Request-scoped data-access facade. Routes every caller to the correct
 * database for the active tenant and (in pool mode) enforces row-level
 * tenant scoping as defense-in-depth.
 *
 * THREE CLIENTS, THREE PURPOSES — pick deliberately:
 *
 *   tenant()   → business data for the ACTIVE tenant.
 *                • pool mode: shared DB, auto-scoped by {tenantId}.
 *                • db-per-tenant mode: the tenant's dedicated database.
 *                Use for services, quotes, customers, templates, etc.
 *
 *   catalog()  → control-plane: identity (User, tokens), tenant registry,
 *                memberships, platform admin. Never holds business data in
 *                db-per-tenant mode.
 *
 *   asPlatformAdmin() → unscoped escape hatch; refuses non-admins. Audited.
 *
 * Most feature services should prefer the request-scoped TENANT_DB token
 * (see database/tenant-db.provider.ts) — it hands back the same client without
 * the scoping wrapper, which is unnecessary once each tenant has its own DB.
 * This facade is the convenience layer for code that wants the pool-mode
 * guardrails too.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private _scoped?: ScopedClient;

  constructor(
    private prisma: PrismaService,
    private catalog: CatalogPrismaService,
    private tenantDb: TenantDatabaseService,
    @Inject(TenantContext) private ctx: TenantContext,
  ) {}

  /** The active tenant's business database client (routed; isolated). */
  tenant(): Promise<PrismaClient> {
    return this.tenantDb.clientFor(this.ctx.requireTenantId());
  }

  /**
   * Tenant client wrapped with automatic {tenantId} injection. Matters in pool
   * mode (it IS the isolation) and is a harmless extra guard in db-per-tenant
   * mode. Memoized per request.
   */
  async scoped(): Promise<ScopedClient> {
    if (!this._scoped) {
      const base = await this.tenant();
      this._scoped = makeScoped(base, this.ctx);
    }
    return this._scoped;
  }

  /** Control-plane client: identity + tenant registry. */
  catalogClient(): CatalogPrismaService {
    return this.catalog;
  }

  /** Platform-admin bypass over the control-plane DB. Refuses non-admins. */
  asPlatformAdmin(): CatalogPrismaService {
    if (!this.ctx.isPlatformAdmin) {
      throw new ForbiddenException('Platform-admin bypass attempted by non-admin');
    }
    return this.catalog;
  }
}

type ScopedClient = ReturnType<typeof makeScoped>;

interface AllOpsArgs {
  model?: string;
  operation: string;
  args: any;
  query: (args: any) => Promise<any>;
}

/**
 * Wrap a client with a $extends layer that injects `where: { tenantId }` on
 * reads and stamps `tenantId` on writes for tenant-scoped models. Unchanged
 * isolation logic from the original pool-mode implementation.
 */
function makeScoped(prisma: PrismaClient, ctx: TenantContext) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: AllOpsArgs) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }
          if (ctx.isPlatformAdmin && !ctx.hasTenant) {
            return query(args);
          }
          const tenantId = ctx.requireTenantId();

          switch (operation) {
            case 'findUnique':
            case 'findUniqueOrThrow':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'findMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
            case 'updateMany':
            case 'deleteMany': {
              args.where = withTenant(args.where, tenantId);
              break;
            }
            case 'update':
            case 'delete': {
              const where = (args.where ?? {}) as Record<string, unknown>;
              const target = await (prisma as any)[lowerFirst(model)].findFirst({
                where: { ...where, tenantId },
                select: { id: true },
              });
              if (!target) {
                throw new ForbiddenException(`Cross-tenant ${operation} blocked on ${model}`);
              }
              break;
            }
            case 'create': {
              args.data = stampTenant(args.data, tenantId);
              break;
            }
            case 'createMany': {
              if (Array.isArray(args.data)) {
                args.data = args.data.map((d: any) => stampTenant(d, tenantId));
              } else if (args.data) {
                args.data = stampTenant(args.data, tenantId);
              }
              break;
            }
            case 'upsert': {
              args.where = withTenant(args.where, tenantId);
              args.create = stampTenant(args.create, tenantId);
              break;
            }
          }
          return query(args);
        },
      },
    },
  });
}

function withTenant(where: any, tenantId: string) {
  if (!where) return { tenantId };
  if (typeof where !== 'object') return where;
  if (Array.isArray(where.AND)) {
    return { ...where, AND: [...where.AND, { tenantId }] };
  }
  return { ...where, tenantId };
}

function stampTenant(data: any, tenantId: string) {
  if (Array.isArray(data)) return data.map((d) => ({ ...d, tenantId }));
  return { ...data, tenantId };
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Source of truth for which models carry a `tenantId`. */
const TENANT_SCOPED_MODELS = new Set([
  'TenantConfig',
  'TenantMembership',
  'CustomerProfile',
  'Service',
  'AutomationTemplate',
  'QuoteRequest',
  'QuoteLineItem',
  'UploadedImage',
  'QuoteStatusHistory',
  'EmailLog',
  'AuditLog',
]);
