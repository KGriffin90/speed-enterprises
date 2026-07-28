/**
 * Creates the two field staff and the five recurring weekday routes.
 *
 *   EMP1_EMAIL="a@x.com" EMP1_NAME="Alex Reyes" \
 *   EMP2_EMAIL="b@x.com" EMP2_NAME="Sam Lee"    \
 *   pnpm --filter @speed-enterprises/api setup:weekly-routes
 *
 * Everything goes through the same authenticated admin endpoints the Team and
 * Templates screens use, so stops are geocoded by the server (Nominatim, ~1 req/s
 * — the 37 stops take about a minute) and the crew is attached exactly as the UI
 * would attach it. Re-running is safe: existing staff are re-used, and a saved
 * route whose name already exists is skipped rather than duplicated.
 *
 * Each weekday is its own WEEKLY saved route anchored to the next occurrence of
 * that weekday, so Monday's stops recur every Monday, Tuesday's every Tuesday,
 * and so on. The nightly scheduler (RouteSchedulerService) materializes the
 * PLANNED routes from there.
 */
import 'dotenv/config';

const API = process.env.API_ORIGIN ?? 'http://localhost:4000';
const SLUG = process.env.TENANT_SLUG ?? 'speedenterprises';
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? 'owner@speedenterprises.com';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? 'Speed!Owner2026';

type Stop = { label: string; addressLine: string; city: string; state: string; postalCode: string };

/** Visit order per weekday, exactly as supplied by the business. */
const WEEKDAY_ROUTES: Array<{ weekday: number; name: string; stops: Stop[] }> = [
  {
    weekday: 1,
    name: 'Monday Route',
    stops: [
      { label: 'West Jordan',        addressLine: '5639 W 7800 S',            city: 'West Jordan',       state: 'UT', postalCode: '84081' },
      { label: 'West Jordan',        addressLine: '3849 S Campus View Dr',    city: 'West Jordan',       state: 'UT', postalCode: '84084' },
      { label: 'Taylorsville',       addressLine: '1796 W 5400 S',            city: 'Taylorsville',      state: 'UT', postalCode: '84129' },
      { label: 'West Valley',        addressLine: '2640 S 5600 W',            city: 'West Valley City',  state: 'UT', postalCode: '84120' },
      { label: 'Magna',              addressLine: '8375 W Arbor Park Dr',     city: 'Magna',             state: 'UT', postalCode: '84044' },
      { label: 'Tooele',             addressLine: '957 N Main St Unit C',     city: 'Tooele',            state: 'UT', postalCode: '84074' },
    ],
  },
  {
    weekday: 2,
    name: 'Tuesday Route',
    stops: [
      { label: 'South Salt Lake',    addressLine: '2140 S State St',          city: 'Salt Lake City',    state: 'UT', postalCode: '84115' },
      { label: 'Mozz',               addressLine: '416 E 900 S',              city: 'Salt Lake City',    state: 'UT', postalCode: '84111' },
      { label: 'Wasatch Co-op',      addressLine: '416 E 900 S',              city: 'Salt Lake City',    state: 'UT', postalCode: '84111' },
      { label: 'Dear Coco',          addressLine: '428 E 900 S Ste 103',      city: 'Salt Lake City',    state: 'UT', postalCode: '84111' },
      { label: 'Downtown',           addressLine: '734 E 400 S',              city: 'Salt Lake City',    state: 'UT', postalCode: '84102' },
      { label: 'Kimball Junction',   addressLine: '6699 N Landmark Dr H150',  city: 'Park City',         state: 'UT', postalCode: '84098' },
      { label: 'Sugarhouse',         addressLine: '1011 E 2100 S',            city: 'Salt Lake City',    state: 'UT', postalCode: '84106' },
      { label: 'Holladay',           addressLine: '1920 E Rodeo Walk Dr',     city: 'Salt Lake City',    state: 'UT', postalCode: '84117' },
      { label: 'Cottonwood Heights', addressLine: '6924 S Park Centre Dr',    city: 'Cottonwood Heights',state: 'UT', postalCode: '84121' },
      { label: 'Murray',             addressLine: '5141 S State St',          city: 'Salt Lake City',    state: 'UT', postalCode: '84107' },
      { label: 'Sandy',              addressLine: '10387 S State St',         city: 'Sandy',             state: 'UT', postalCode: '84070' },
    ],
  },
  {
    weekday: 3,
    name: 'Wednesday Route',
    stops: [
      { label: 'Riverton',           addressLine: '4599 W Partridgehill Ln',  city: 'Riverton',          state: 'UT', postalCode: '84096' },
      { label: 'Saratoga Springs',   addressLine: '889 N Redwood Rd',         city: 'Saratoga Springs',  state: 'UT', postalCode: '84045' },
      { label: 'Lehi',               addressLine: '3601 N Digital Dr',        city: 'Lehi',              state: 'UT', postalCode: '84043' },
      { label: 'Pleasant Grove',     addressLine: '470 S Pleasant Grove Blvd',city: 'Pleasant Grove',    state: 'UT', postalCode: '84062' },
      { label: 'Vineyard',           addressLine: '661 E 450 N',              city: 'Vineyard',          state: 'UT', postalCode: '84059' },
      { label: 'South Jordan',       addressLine: '3561 W 11400 S',           city: 'South Jordan',      state: 'UT', postalCode: '84095' },
      { label: 'Mozz',               addressLine: '10420 S Rubicon Rd Unit B101', city: 'South Jordan',  state: 'UT', postalCode: '84095' },
    ],
  },
  {
    weekday: 4,
    name: 'Thursday Route',
    stops: [
      { label: 'West Bountiful',     addressLine: '135 N 500 W',              city: 'Bountiful',         state: 'UT', postalCode: '84010' },
      { label: 'Centerville',        addressLine: '370 W Parrish Ln',         city: 'Centerville',       state: 'UT', postalCode: '84014' },
      { label: 'Farmington',         addressLine: '138 N 1100 W',             city: 'Farmington',        state: 'UT', postalCode: '84025' },
      { label: 'Layton',             addressLine: '1035 W Antelope Dr',       city: 'Layton',            state: 'UT', postalCode: '84041' },
      { label: 'Syracuse',           addressLine: '1975 W 1700 S',            city: 'Syracuse',          state: 'UT', postalCode: '84075' },
      { label: 'Clinton',            addressLine: '2654 N 2000 W',            city: 'Clinton',           state: 'UT', postalCode: '84015' },
      { label: 'Riverdale',          addressLine: '849 W Riverdale Rd',       city: 'Ogden',             state: 'UT', postalCode: '84405' },
      { label: 'Ogden',              addressLine: '1269 Washington Blvd',     city: 'Ogden',             state: 'UT', postalCode: '84404' },
    ],
  },
  {
    weekday: 5,
    name: 'Friday Route',
    stops: [
      { label: 'Orem',               addressLine: '715 E University Pkwy',    city: 'Orem',              state: 'UT', postalCode: '84097' },
      { label: 'Provo',              addressLine: '1284 N University Ave',    city: 'Provo',             state: 'UT', postalCode: '84604' },
      { label: 'Mozz Provo',         addressLine: '145 N University Ave',     city: 'Provo',             state: 'UT', postalCode: '84601' },
      { label: 'Spanish Fork',       addressLine: '841 E Highway 6',          city: 'Spanish Fork',      state: 'UT', postalCode: '84660' },
      { label: 'Eagle Mountain',     addressLine: '4315 E Pony Express Pkwy', city: 'Eagle Mountain',    state: 'UT', postalCode: '84005' },
    ],
  },
];

/** Next date (UTC midnight) landing on `weekday`, today included. */
function nextWeekday(weekday: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((weekday - d.getUTCDay() + 7) % 7));
  return d.toISOString();
}

async function main() {
  const staff = [
    { email: process.env.EMP1_EMAIL, name: process.env.EMP1_NAME ?? 'Employee One' },
    { email: process.env.EMP2_EMAIL, name: process.env.EMP2_NAME ?? 'Employee Two' },
  ];
  if (!staff[0]!.email || !staff[1]!.email) {
    console.error('Set EMP1_EMAIL and EMP2_EMAIL (and optionally EMP1_NAME / EMP2_NAME).');
    process.exit(1);
  }

  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  if (!login.ok) { console.error(`Owner login failed (${login.status}). Is the API running at ${API}?`); process.exit(1); }
  const { accessToken } = await login.json() as { accessToken: string };

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': SLUG, Authorization: `Bearer ${accessToken}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };

  // ── Staff ────────────────────────────────────────────────────────────────
  console.log('Creating staff…');
  const team = await api('GET', '/api/me/team') as Array<{ id: string; user: { email: string } }>;
  const membershipIds: string[] = [];
  for (const s of staff) {
    const existing = team.find((m) => m.user.email.toLowerCase() === s.email!.toLowerCase());
    if (existing) {
      console.log(`  = ${s.email} already on the team`);
      membershipIds.push(existing.id);
      continue;
    }
    const r = await api('POST', '/api/me/team/invite', { email: s.email, fullName: s.name, role: 'STAFF' }) as { membershipId: string };
    console.log(`  + ${s.email} (${s.name}) — STAFF, password-setup email sent`);
    membershipIds.push(r.membershipId);
  }

  // ── Saved routes ─────────────────────────────────────────────────────────
  console.log('\nCreating weekly saved routes (geocoding stops — this takes a minute)…');
  const templates = await api('GET', '/api/admin/route-templates') as Array<{ id: string; name: string }>;
  for (const day of WEEKDAY_ROUTES) {
    if (templates.some((t) => t.name === day.name)) {
      console.log(`  = ${day.name} already exists — skipped`);
      continue;
    }
    await api('POST', '/api/admin/route-templates', {
      name: day.name,
      recurrence: 'WEEKLY',
      startDate: nextWeekday(day.weekday),
      membershipIds,
      stops: day.stops,
    });
    console.log(`  + ${day.name} — ${day.stops.length} stops, recurs weekly`);
  }

  console.log('\nDone. The nightly scheduler fills in each day\'s PLANNED route;');
  console.log('templates also seed their next occurrence immediately on save.');
}

main().catch((e) => { console.error(e); process.exit(1); });
