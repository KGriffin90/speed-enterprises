import { Injectable, Scope } from '@nestjs/common';
import { PlatformRole, TenantRole } from '@speed-enterprises/shared';

/**
 * Request-scoped tenant context. Populated by TenantMiddleware before any
 * controller runs. Subsequent services (PrismaService extension, guards,
 * controllers) read tenant identity from here — never directly from the
 * request, never from a header, never from a JWT.
 *
 * Why request-scoped: NestJS gives us a fresh instance per HTTP request, so
 * a service that injects this gets the right tenant automatically without
 * passing it through every call.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  private _tenantId: string | null = null;
  private _tenantSlug: string | null = null;
  private _tenantName: string | null = null;
  private _userId: string | null = null;
  private _userEmail: string | null = null;
  private _platformRole: PlatformRole | null = null;
  private _tenantRole: TenantRole | null = null;
  private _impersonatedBy: string | null = null;

  setTenant(t: { id: string; slug: string; name: string }) {
    this._tenantId = t.id;
    this._tenantSlug = t.slug;
    this._tenantName = t.name;
  }

  setUser(u: {
    id: string;
    email: string;
    platformRole: PlatformRole;
    tenantRole?: TenantRole;
    impersonatedBy?: string;
  }) {
    this._userId = u.id;
    this._userEmail = u.email;
    this._platformRole = u.platformRole;
    this._tenantRole = u.tenantRole ?? null;
    this._impersonatedBy = u.impersonatedBy ?? null;
  }

  // ── Reads ────────────────────────────────────────────
  get tenantId(): string | null  { return this._tenantId; }
  get tenantSlug(): string | null { return this._tenantSlug; }
  get tenantName(): string | null { return this._tenantName; }
  get userId(): string | null    { return this._userId; }
  get userEmail(): string | null { return this._userEmail; }
  get platformRole(): PlatformRole | null { return this._platformRole; }
  get tenantRole(): TenantRole | null     { return this._tenantRole; }
  get impersonatedBy(): string | null     { return this._impersonatedBy; }

  get isAuthenticated(): boolean { return this._userId !== null; }
  get isPlatformAdmin(): boolean { return this._platformRole === 'PLATFORM_ADMIN'; }
  get hasTenant(): boolean       { return this._tenantId !== null; }

  requireTenantId(): string {
    if (!this._tenantId) {
      throw new Error('TenantContext: tenantId not set — TenantMiddleware did not resolve');
    }
    return this._tenantId;
  }

  requireUserId(): string {
    if (!this._userId) throw new Error('TenantContext: userId not set');
    return this._userId;
  }
}
