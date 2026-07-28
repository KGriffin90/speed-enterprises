import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response, NextFunction } from 'express';
import { TenantContext } from './tenant-context';
import { TenantService } from './tenant.service';
import type { PlatformRole, TenantRole } from '@speed-enterprises/shared';

/**
 * Resolves the active tenant for this request and populates TenantContext.
 *
 * Resolution order (first hit wins):
 *   1. JWT claim `tenantId` — authenticated requests.
 *   2. `X-Tenant-Slug` header — anonymous public endpoints (e.g. public quote form).
 *   3. `Host` header subdomain or custom domain match.
 *
 * Cross-checks:
 *   - If both a JWT tenant claim AND a header/host tenant are present, they must agree.
 *   - Suspended/archived tenants are rejected on every endpoint except platform admin.
 *   - Platform-admin requests can pass an explicit slug header to operate on any tenant.
 *
 * Routes that don't need a tenant (e.g. /health, /auth/register-platform-admin,
 * /platform/*) skip this middleware via configuration in AppModule.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private jwt: JwtService,
    private tenants: TenantService,
    private ctx: TenantContext,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    let jwtTenantId: string | null = null;
    let jwtUserId: string | null = null;
    let jwtUserEmail: string | null = null;
    let jwtPlatformRole: PlatformRole | null = null;
    let jwtTenantRole: TenantRole | undefined;
    let jwtImpersonatedBy: string | undefined;

    // 1) JWT
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length);
      try {
        const payload: any = await this.jwt.verifyAsync(token);
        jwtUserId       = payload.sub ?? null;
        jwtUserEmail    = payload.email ?? null;
        jwtTenantId     = payload.tenantId ?? null;
        jwtPlatformRole = (payload.platformRole as PlatformRole) ?? 'CUSTOMER';
        jwtTenantRole   = payload.tenantRole;
        jwtImpersonatedBy = payload.impersonatedBy;
      } catch {
        // Invalid token — leave fields null; protected routes will 401 themselves
      }
    }

    // 2) header
    const headerSlug = readHeader(req, 'x-tenant-slug');
    // 3) host
    const hostSlug = parseSlugFromHost(req.headers.host ?? '', process.env.PLATFORM_DOMAIN);
    const customDomain = (req.headers.host ?? '').toLowerCase().split(':')[0]!;

    // Pick tenant (JWT > header > host)
    let resolvedTenantId: string | null = jwtTenantId;
    let resolvedTenantSlug: string | null = null;
    let resolvedTenantName: string | null = null;

    if (resolvedTenantId) {
      const t = await this.tenants.findById(resolvedTenantId);
      if (t) {
        resolvedTenantSlug = t.slug;
        resolvedTenantName = t.businessName;
        if (t.status !== 'ACTIVE' && t.status !== 'TRIAL' && jwtPlatformRole !== 'PLATFORM_ADMIN') {
          throw new ForbiddenException(`Tenant ${t.slug} is ${t.status.toLowerCase()}`);
        }
      } else {
        // JWT references a tenant that no longer exists
        resolvedTenantId = null;
      }
    }

    // Customers belong to multiple tenants. When the header names a different
    // tenant from the JWT's original login tenant, switch to the header tenant
    // so the customer can operate on whichever page they are currently viewing.
    // Staff / Admin / Owner are bound to a single tenant — not overridden here.
    if (resolvedTenantId && headerSlug && jwtTenantRole === 'CUSTOMER') {
      const hTenant = await this.tenants.findBySlug(headerSlug);
      if (hTenant && hTenant.id !== resolvedTenantId &&
          (hTenant.status === 'ACTIVE' || hTenant.status === 'TRIAL')) {
        resolvedTenantId   = hTenant.id;
        resolvedTenantSlug = hTenant.slug;
        resolvedTenantName = hTenant.businessName;
      }
    }

    if (!resolvedTenantId && headerSlug) {
      const t = await this.tenants.findBySlug(headerSlug);
      if (t) {
        if (t.status !== 'ACTIVE' && t.status !== 'TRIAL') {
          throw new ForbiddenException(`Tenant ${t.slug} is ${t.status.toLowerCase()}`);
        }
        resolvedTenantId   = t.id;
        resolvedTenantSlug = t.slug;
        resolvedTenantName = t.businessName;
      }
    }

    if (!resolvedTenantId && hostSlug) {
      const t = await this.tenants.findBySlug(hostSlug);
      if (t && (t.status === 'ACTIVE' || t.status === 'TRIAL')) {
        resolvedTenantId   = t.id;
        resolvedTenantSlug = t.slug;
        resolvedTenantName = t.businessName;
      }
    }

    if (!resolvedTenantId && customDomain && !isPlatformHost(customDomain, process.env.PLATFORM_DOMAIN)) {
      const t = await this.tenants.findByCustomDomain(customDomain);
      if (t && (t.status === 'ACTIVE' || t.status === 'TRIAL')) {
        resolvedTenantId   = t.id;
        resolvedTenantSlug = t.slug;
        resolvedTenantName = t.businessName;
      }
    }

    // Cross-check: JWT tenant vs header tenant.
    // Skipped for CUSTOMER role — customers are multi-tenant and the override
    // above already resolved the correct tenant from the header.
    // Skipped for PLATFORM_ADMIN — they operate across all tenants.
    if (jwtTenantId && headerSlug && jwtTenantRole !== 'CUSTOMER' && jwtPlatformRole !== 'PLATFORM_ADMIN') {
      const headerTenant = await this.tenants.findBySlug(headerSlug);
      if (headerTenant && headerTenant.id !== jwtTenantId) {
        throw new ForbiddenException(
          'This account is not linked to the selected business. ' +
          'If you believe this is an error, contact support at support@speedenterprises.app.',
        );
      }
    }

    if (resolvedTenantId && resolvedTenantSlug && resolvedTenantName) {
      this.ctx.setTenant({ id: resolvedTenantId, slug: resolvedTenantSlug, name: resolvedTenantName });
    }

    if (jwtUserId && jwtUserEmail && jwtPlatformRole) {
      this.ctx.setUser({
        id: jwtUserId,
        email: jwtUserEmail,
        platformRole: jwtPlatformRole,
        tenantRole: jwtTenantRole,
        impersonatedBy: jwtImpersonatedBy,
      });
    }

    // Mirror onto the express request for parameter decorators (CurrentTenant,
    // CurrentUser). Decorators receive the raw request and can't reliably read
    // request-scoped DI.
    (req as any).tenantContext = {
      tenantId:   resolvedTenantId,
      tenantSlug: resolvedTenantSlug,
      tenantName: resolvedTenantName,
      userId:        jwtUserId,
      userEmail:     jwtUserEmail,
      platformRole:  jwtPlatformRole,
      tenantRole:    jwtTenantRole,
      impersonatedBy: jwtImpersonatedBy,
    };

    next();
  }
}

function readHeader(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (typeof v === 'string') return v.trim().toLowerCase() || null;
  if (Array.isArray(v) && v[0]) return v[0].trim().toLowerCase() || null;
  return null;
}

/**
 * For host `acme.speedenterprises.app` with PLATFORM_DOMAIN `speedenterprises.app`, returns `acme`.
 * Returns null for the platform apex host itself.
 */
function parseSlugFromHost(host: string, platformDomain?: string): string | null {
  if (!host || !platformDomain) return null;
  const cleaned = host.toLowerCase().split(':')[0]!;
  if (cleaned === platformDomain || cleaned === `www.${platformDomain}`) return null;
  if (cleaned.endsWith(`.${platformDomain}`)) {
    const sub = cleaned.slice(0, -1 * (platformDomain.length + 1));
    // Ignore reserved subdomains
    if (['www', 'api', 'admin', 'platform', 'mail', 'app'].includes(sub)) return null;
    return sub;
  }
  return null;
}

function isPlatformHost(host: string, platformDomain?: string): boolean {
  if (!platformDomain) return false;
  return host === platformDomain
      || host === `www.${platformDomain}`
      || host === `api.${platformDomain}`
      || host === `admin.${platformDomain}`
      || host === `platform.${platformDomain}`
      || host === `app.${platformDomain}`
      || host === 'localhost'
      || host.startsWith('127.0.0.1');
}
