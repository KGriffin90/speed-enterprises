import { NextRequest, NextResponse } from 'next/server';

/**
 * TENANT RESOLUTION AT THE EDGE
 * ═════════════════════════════
 * The tenant must be derived from something tied to THIS request — the host or
 * the URL — so that it survives refreshes, shared links, new tabs, redirects,
 * SSR, and deep navigation. It must NEVER be silently inherited from a cookie
 * across a tenant boundary (that was the "wrong business after navigating" bug).
 *
 * RESOLUTION (production = subdomain, development = path):
 *   1. Host subdomain of PLATFORM_DOMAIN     → acme.speedenterprises.app          → 'acme'
 *      (authoritative in production; reserved subdomains are ignored)
 *   2. Path prefix /t/<slug>/…               → localhost:3000/t/acme/…    → 'acme'
 *      (primary local-dev mechanism; rewritten away so the app tree is flat)
 *   3. Query ?tenant=<slug>                   → …/?tenant=acme             → 'acme'
 *   4. Cookie tenant_slug                     → LAST RESORT, dev only
 *
 * INVARIANTS
 *   • A real tenant host (rule 1) is authoritative: cookie/query/path can never
 *     override it. Visiting acme.speedenterprises.app ALWAYS renders acme.
 *   • On the platform apex with no tenant signal, we DO NOT fall back to the
 *     cookie — so visiting speedenterprises.app never shows a stale tenant.
 *   • Whenever we resolve a tenant, we reconcile the cookie to it; whenever we
 *     resolve none on the apex, we clear the cookie. The cookie can therefore
 *     never drift out of sync with the URL.
 */

const PLATFORM_DOMAIN = (process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? process.env.PLATFORM_DOMAIN ?? 'localhost:3000').toLowerCase();
const PLATFORM_APEX = PLATFORM_DOMAIN.split(':')[0]!; // strip port for hostname math

// Subdomains that are platform infrastructure, never tenants.
const RESERVED = new Set(['www', 'api', 'admin', 'platform', 'mail', 'app', 'docs', 'status', 'cdn', 'assets']);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/; // lowercase, 3–40 chars, no leading/trailing dash

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = (req.headers.get('host') ?? '').toLowerCase().split(':')[0]!;

  const hostTenant = tenantFromHost(hostname);
  const isApex = hostname === PLATFORM_APEX || hostname === `www.${PLATFORM_APEX}`;
  const underPlatform = hostname === PLATFORM_APEX || hostname.endsWith(`.${PLATFORM_APEX}`);
  // A custom domain is a host we don't own: not the apex, not a platform
  // subdomain (tenant OR reserved like admin.*), and not local loopback.
  const isCustomDomain = !hostTenant && !isApex && !underPlatform && !isLoopback(hostname);

  // Path-based tenant (dev): /t/<slug>/rest
  const pathMatch = url.pathname.match(/^\/t\/([^/]+)(\/.*)?$/);
  const pathTenant = pathMatch ? sanitizeSlug(pathMatch[1]) : null;

  const queryTenant = sanitizeSlug(url.searchParams.get('tenant'));
  const cookieTenant = sanitizeSlug(req.cookies.get('tenant_slug')?.value ?? null);

  // ── Decide the tenant ────────────────────────────────────────────────────
  let slug: string | null = null;
  let rewritePathTo: string | null = null;

  if (hostTenant) {
    // Production tenant subdomain is authoritative.
    slug = hostTenant;
    if (pathTenant) {
      // /t/<slug> under a real tenant host is meaningless/ambiguous — strip it.
      rewritePathTo = pathMatch![2] ?? '/';
    }
  } else if (pathTenant) {
    // Local-dev path routing: adopt the slug and rewrite it out of the path.
    slug = pathTenant;
    rewritePathTo = pathMatch![2] ?? '/';
  } else if (queryTenant) {
    slug = queryTenant;
  } else if ((!isApex || isLoopback(hostname)) && !isCustomDomain && cookieTenant) {
    // Cookie fallback: used in local dev (loopback) where every request arrives
    // on the apex hostname so there is no subdomain signal. On the production apex
    // (non-loopback) we deliberately skip this to prevent stale-cookie cross-tenant
    // bleed when a user navigates back to the platform landing without a tenant.
    //
    // Exception: never use the cookie on the platform apex landing paths (/ and
    // /platform) when there is no explicit tenant in the URL. These paths are
    // intentionally tenant-neutral; inheriting a stale cookie would cause the
    // wrong tenant's nav/footer/theme to render on the platform homepage.
    const isApexLandingPath = url.pathname === '/' || url.pathname.startsWith('/platform');
    if (!isApexLandingPath) {
      slug = cookieTenant;
    }
  }

  // ── Single-tenant standalone fallback ─────────────────────────────────────
  // This deployment serves exactly one business (Speed Enterprises). When no
  // host/path/query/cookie signal resolves a tenant (e.g. bare localhost:3000),
  // fall back to the configured default so the app ALWAYS renders that tenant
  // instead of the platform landing page.
  if (!slug) {
    const def = sanitizeSlug(process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? null);
    if (def) slug = def;
  }

  // ── Cross-tenant session isolation ────────────────────────────────────────
  // A session belongs only to the tenant(s) the user is a member of. Session
  // cookies are host-scoped, so in local dev (one host for every tenant) one
  // company's cookie is physically sent to another company's pages. If a user
  // carries a session for company A and browses to company B, they are NOT
  // authenticated on B — we clear the auth cookies so they are genuinely logged
  // out, not merely hidden in the UI. Platform admins operate across all tenants.
  let foreignSession = false;
  if (slug) {
    const me = parseMe(req.cookies.get('tp_me')?.value);
    if (me && me.platformRole !== 'PLATFORM_ADMIN') {
      foreignSession = !me.memberships.some((m) => m.tenantSlug === slug);
    }
  }

  // ── Quote routes are PUBLIC ────────────────────────────────────────────────
  // Customers complete the entire quote wizard anonymously; the account gate
  // happens at SUBMISSION (the wizard persists the draft, sends them to sign-up,
  // then resumes and submits after email verification). So we intentionally do
  // NOT redirect /quote/* to sign-up here anymore. Dashboard/admin stay guarded
  // by their own page-level readMe() checks. A carried-over foreign-tenant
  // session is still cleared below (foreignSession), so an anonymous-on-this-
  // tenant visitor is treated as logged out and the wizard renders unauthed.

  // ── Build the forwarded request ──────────────────────────────────────────
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete('x-tenant-slug');
  requestHeaders.delete('x-tenant-host');
  if (slug) requestHeaders.set('x-tenant-slug', slug);
  if (isCustomDomain) requestHeaders.set('x-tenant-host', hostname); // resolved to a slug server-side

  let res: NextResponse;
  if (rewritePathTo !== null) {
    const dest = url.clone();
    dest.pathname = rewritePathTo;
    res = NextResponse.rewrite(dest, { request: { headers: requestHeaders } });
  } else {
    res = NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Browsing into a company you have no session for logs you out of the carried-
  // over session — genuinely, by clearing the auth cookies (see foreignSession).
  if (foreignSession) clearAuthCookies(res);

  // ── Reconcile the cookie so it can never drift from the URL ───────────────
  if (slug) {
    if (cookieTenant !== slug) {
      res.cookies.set('tenant_slug', slug, { path: '/', sameSite: 'lax', httpOnly: false });
    }
  } else if (isApex && !isLoopback(hostname) && cookieTenant) {
    // Only clear the stale tenant cookie when on the production apex (non-loopback).
    // On localhost every page is "apex", so we must not erase the cookie mid-flow.
    const isApexLanding = url.pathname === '/' || url.pathname.startsWith('/platform');
    if (isApexLanding) res.cookies.delete('tenant_slug');
  }

  return res;
}

/** acme.speedenterprises.app → 'acme'; speedenterprises.app/www → null; reserved subs → null. */
function tenantFromHost(hostname: string): string | null {
  if (!hostname || hostname === PLATFORM_APEX || hostname === `www.${PLATFORM_APEX}`) return null;
  if (!hostname.endsWith(`.${PLATFORM_APEX}`)) return null; // not under the platform domain
  const sub = hostname.slice(0, -(PLATFORM_APEX.length + 1));
  if (sub.includes('.')) return null; // multi-level subdomain — not a tenant
  if (RESERVED.has(sub)) return null;
  return sanitizeSlug(sub);
}

interface ParsedMe {
  platformRole: string;
  memberships: Array<{ tenantSlug: string }>;
}

/** Parse the (URL-encoded JSON) tp_me cookie for tenant-membership checks.
 *  Presence/shape only — never a security boundary; the API verifies the JWT. */
function parseMe(raw: string | undefined): ParsedMe | null {
  if (!raw) return null;
  try {
    const me = JSON.parse(decodeURIComponent(raw));
    const platformRole = me?.user?.platformRole ?? 'CUSTOMER';
    const memberships = Array.isArray(me?.memberships)
      ? me.memberships.filter((m: any) => typeof m?.tenantSlug === 'string')
      : [];
    return { platformRole, memberships };
  } catch {
    return null;
  }
}

/** Expire the auth/session cookies so a carried-over foreign session is gone. */
function clearAuthCookies(res: NextResponse): void {
  for (const name of ['tp_access', 'tp_refresh', 'tp_me']) {
    res.cookies.set(name, '', { path: '/', maxAge: 0, sameSite: 'lax' });
  }
}

function sanitizeSlug(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  return SLUG_RE.test(s) ? s : null;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost');
}

export const config = {
  matcher: [
    // Everything except Next internals, static assets, and /.well-known.
    //
    // .well-known is excluded because the domain-verification files served
    // there (apple-app-site-association, assetlinks.json) are fetched by Apple's
    // CDN and Android's verifier, which follow ZERO redirects and expect a bare
    // JSON body. Running tenant resolution on those requests would attach
    // Set-Cookie headers and — on a /t/<slug> style path — could rewrite the
    // URL out from under them, silently breaking Universal Links / App Links.
    '/((?!_next/|\\.well-known/|favicon|robots|sitemap|.*\\.(?:png|jpg|jpeg|svg|ico|css|js|map|txt|woff2?)$).*)',
  ],
};
