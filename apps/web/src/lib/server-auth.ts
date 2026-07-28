import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SessionResponseDto, TenantRole } from '@speed-enterprises/shared';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

/**
 * The tenant in scope for the current request. Set by the edge middleware as
 * the `x-tenant-slug` header (derived from subdomain in prod, path/query in
 * dev); falls back to the reconciled `tenant_slug` cookie.
 */
function activeTenantSlug(): string | null {
  const fromHeader = headers().get('x-tenant-slug');
  if (fromHeader) return fromHeader;
  return cookies().get('tenant_slug')?.value ?? null;
}

/**
 * Read the persisted me-payload from the session cookie set by client auth.
 * No JWT verification here — this is for *display* and routing only. The
 * API does its own JWT verification on every request.
 *
 * TENANT ISOLATION
 * ════════════════
 * Session cookies are host-scoped, so in local dev (every tenant on
 * localhost:3000) and behind any shared host, one tenant's `tp_me` cookie is
 * physically sent to every other tenant's pages. A session is only valid on a
 * tenant the user is actually a member of — otherwise we report "not signed in"
 * for that tenant. This stops e.g. the ES Solar owner from appearing logged in
 * on Hunt Electric. (The API independently rejects cross-tenant data via the
 * JWT-vs-header check; this guards the web UI's display/routing layer.)
 */
export function readMe(): SessionResponseDto | null {
  const raw = cookies().get('tp_me')?.value;
  if (!raw) return null;

  let me: SessionResponseDto;
  try { me = JSON.parse(decodeURIComponent(raw)) as SessionResponseDto; }
  catch { return null; }

  // Platform admins operate across all tenants by design.
  if (me.user.platformRole === 'PLATFORM_ADMIN') return me;

  const activeSlug = activeTenantSlug();
  // No tenant in scope (platform-neutral pages) — nothing to cross.
  if (!activeSlug) return me;

  // The session is valid only on a tenant this user belongs to.
  const membership = me.memberships.find(m => m.tenantSlug === activeSlug);
  if (!membership) return null;

  // Re-scope the active tenant to the one being viewed so role/name/id are
  // correct even for multi-tenant customers switching between businesses.
  return {
    ...me,
    tenant: {
      id:   membership.tenantId,
      slug: membership.tenantSlug,
      name: membership.tenantName,
      role: membership.role,
    },
  };
}

/** Redirect to /auth/sign-in if there's no session cookie. */
export function requireAuth(): SessionResponseDto {
  const me = readMe();
  if (!me) redirect('/auth/sign-in');
  return me;
}

/** Redirect to / if the user is not a platform admin. */
export function requirePlatformAdmin(): SessionResponseDto {
  const me = requireAuth();
  if (me.user.platformRole !== 'PLATFORM_ADMIN') redirect('/');
  return me;
}

/** Redirect if the user lacks the required tenant role for the active tenant. */
export function requireTenantRole(minRole: TenantRole): SessionResponseDto {
  const me = requireAuth();
  const rank: Record<TenantRole, number> = { CUSTOMER: 0, STAFF: 10, OWNER: 20 };
  const have = me.tenant?.role ?? 'CUSTOMER';
  if (rank[have] < rank[minRole]) redirect('/');
  return me;
}

/** Server-side authenticated API call (uses cookie's access token + tenant slug). */
export async function apiServer<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const access = cookies().get('tp_access')?.value;
  const tenantSlug = headers().get('x-tenant-slug') ?? cookies().get('tenant_slug')?.value;
  const h = new Headers({ Accept: 'application/json' });
  if (body !== undefined) h.set('Content-Type', 'application/json');
  if (access) h.set('Authorization', `Bearer ${access}`);
  if (tenantSlug) h.set('X-Tenant-Slug', tenantSlug);

  const res = await fetch(`${API_ORIGIN}${path}`, {
    method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/auth/sign-in');
  if (!res.ok) throw new Error(`API ${res.status} on ${method} ${path}`);
  return (await res.json()) as T;
}
