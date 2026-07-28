/**
 * Lightweight, key-free forward geocoding (street address → lat/lng) used to
 * give route stops coordinates, which the GPS geofence (routes.service.ts) needs
 * to auto-detect arrival/departure.
 *
 * Backed by OpenStreetMap's Nominatim — no API key required. It is BEST-EFFORT:
 * any failure (network, rate limit, no match) returns null so a stop simply
 * saves without coordinates and is skipped by the geofence, never blocking a
 * route from being created.
 *
 * Nominatim's usage policy asks for an identifying User-Agent and low request
 * volume (a business builds a handful of routes a day, so we're well within it).
 * To move to a higher-volume or keyed provider (Google/Mapbox), swap the body of
 * `geocodeAddress` — the rest of the app only depends on its {lat,lng} result.
 */

export interface GeocodeAddress {
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Identifying UA per Nominatim policy; falls back to platform defaults.
const USER_AGENT = `${process.env.PLATFORM_NAME ?? 'Speed Enterprises'} route-geocoder (${
  process.env.PLATFORM_SUPPORT_EMAIL ?? 'support@speedenterprises.app'
})`;

/**
 * Nominatim allows at most one request per second and throttles callers that
 * exceed it — a burst silently starts returning nothing, which shows up as
 * stops saving without coordinates and being skipped by the geofence. Every
 * lookup is therefore funnelled through one process-wide queue that keeps
 * requests at least MIN_INTERVAL_MS apart.
 */
const MIN_INTERVAL_MS = 1100;
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined); // a failure must not wedge the queue
  return run;
}

/** One Nominatim call. Returns null on any non-success so callers can retry. */
async function lookup(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const rows = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const top = rows[0];
    if (!top) return null;

    const lat = Number(top.lat);
    const lng = Number(top.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null; // best-effort: never block a route save on geocoding
  }
}

/**
 * US Census Bureau geocoder — free, key-free, and authoritative for US street
 * addresses. It carries many newer commercial addresses that OpenStreetMap has
 * never had, so it's the fallback whenever Nominatim comes up empty. Not paced:
 * it publishes no rate limit and is a per-address last resort.
 */
const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

async function censusLookup(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `${CENSUS_URL}?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }> } };
    const c = body.result?.addressMatches?.[0]?.coordinates;
    if (!c || !Number.isFinite(c.y) || !Number.isFinite(c.x)) return null;
    return { lat: c.y as number, lng: c.x as number }; // Census returns x=lng, y=lat
  } catch {
    return null;
  }
}

/** Returns {lat,lng} for the address, or null when it can't be resolved. */
export async function geocodeAddress(addr: GeocodeAddress): Promise<{ lat: number; lng: number } | null> {
  const parts = [addr.addressLine, addr.city, addr.state, addr.postalCode]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);
  if (parts.length === 0) return null;

  const full = parts.join(', ');
  const hit = await paced(() => lookup(full));
  if (hit) return hit;

  // A unit/suite in the street line is the usual reason a real address misses.
  // Retry once without it — this also absorbs a transient throttle, since the
  // retry lands a full interval later.
  const trimmed = addr.addressLine?.replace(/[,]?\s*(ste|suite|unit|apt|#)\s*\S+$/i, '').trim();
  const withoutUnit =
    trimmed && trimmed !== addr.addressLine?.trim()
      ? [trimmed, addr.city, addr.state, addr.postalCode].map((p) => p?.trim()).filter((p): p is string => !!p).join(', ')
      : null;
  if (withoutUnit) {
    const retry = await paced(() => lookup(withoutUnit));
    if (retry) return retry;
  }

  // Last resort: the Census geocoder, on the unit-stripped form when we have one.
  return censusLookup(withoutUnit ?? full);
}
