/**
 * Fills in missing lat/lng on route stops.
 *
 *   pnpm --filter @speed-enterprises/api backfill:stop-coords
 *
 * A stop with no coordinates is invisible to the GPS geofence, so its arrival
 * and departure are never detected and it contributes no on-site time. Stops
 * save regardless of whether geocoding succeeded (by design — a lookup failure
 * must never block building a route), so any batch saved while the geocoder was
 * being throttled needs a second pass.
 *
 * Covers saved-route (template) stops and the stops on any already-generated
 * route. Safe to re-run: only rows still missing coordinates are touched.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { geocodeAddress } from '../src/routes/geocode';

const prisma = new PrismaClient();

async function main() {
  const tplStops = await prisma.routeTemplateStop.findMany({
    where: { lat: null },
    select: { id: true, label: true, addressLine: true, city: true, state: true, postalCode: true },
  });
  const routeStops = await prisma.routeStop.findMany({
    where: { lat: null },
    select: { id: true, label: true, addressLine: true, city: true, state: true, postalCode: true },
  });

  const total = tplStops.length + routeStops.length;
  if (total === 0) { console.log('Every stop already has coordinates.'); return; }
  console.log(`${total} stop(s) missing coordinates (${tplStops.length} saved-route, ${routeStops.length} route).`);
  console.log('Geocoding at ~1/sec per Nominatim policy…\n');

  let ok = 0;
  for (const s of tplStops) {
    const geo = await geocodeAddress(s);
    if (geo) {
      await prisma.routeTemplateStop.update({ where: { id: s.id }, data: { lat: geo.lat, lng: geo.lng } });
      ok++;
      console.log(`  ✓ ${s.label} — ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`);
    } else {
      console.log(`  ✗ ${s.label} (${[s.addressLine, s.city].filter(Boolean).join(', ')}) — no match`);
    }
  }
  for (const s of routeStops) {
    const geo = await geocodeAddress(s);
    if (geo) {
      await prisma.routeStop.update({ where: { id: s.id }, data: { lat: geo.lat, lng: geo.lng } });
      ok++;
      console.log(`  ✓ ${s.label} (route) — ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`);
    } else {
      console.log(`  ✗ ${s.label} (route) — no match`);
    }
  }

  console.log(`\nResolved ${ok}/${total}. Any remaining need coordinates set by hand on the stop.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
