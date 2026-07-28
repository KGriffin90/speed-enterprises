import 'server-only';
import { headers } from 'next/headers';
import type { BusinessConfig } from '@speed-enterprises/shared';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

export class UnknownTenantError extends Error {
  constructor(slug: string | null) {
    super(slug ? `Unknown tenant: ${slug}` : 'No tenant in request');
    this.name = 'UnknownTenantError';
  }
}

/**
 * The active tenant slug for this request.
 *
 * SINGLE SOURCE OF TRUTH: the `x-tenant-slug` header set by middleware.ts after
 * it resolves the tenant from the host/path. We deliberately do NOT fall back
 * to the cookie here: the cookie lags the URL by one navigation, so trusting it
 * is exactly how a stale tenant leaks onto the platform apex or a different
 * tenant's page. If middleware didn't set the header, there is no tenant.
 */
export function getTenantSlug(): string | null {
  return headers().get('x-tenant-slug');
}

/**
 * Fetch the full BusinessConfig for the active tenant. Cached for 60 seconds
 * — the API bumps configVersion on writes so cached responses won't be too
 * stale in practice. Throws `UnknownTenantError` if no tenant resolved or the
 * slug isn't in the system.
 */
export async function loadTenantConfig(): Promise<BusinessConfig> {
  const slug = getTenantSlug();
  if (!slug) throw new UnknownTenantError(null);

  const res = await fetch(`${API_ORIGIN}/api/config/${encodeURIComponent(slug)}`, {
    next: { revalidate: 60, tags: [`tenant:${slug}`] },
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) throw new UnknownTenantError(slug);
  if (!res.ok) {
    throw new Error(`Config API ${res.status} for ${slug}`);
  }
  return (await res.json()) as BusinessConfig;
}

/** Server action helper — POST a public quote request for the resolved tenant. */
export async function postPublicQuote(payload: unknown): Promise<{ id?: string; error?: string }> {
  const slug = getTenantSlug();
  if (!slug) return { error: 'No tenant in scope' };
  const res = await fetch(`${API_ORIGIN}/api/public/quotes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': slug,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    return { error: body || `API ${res.status}` };
  }
  const data = await res.json();
  return { id: data.id };
}
