import { PrismaClient, RouteRecurrence } from '@prisma/client';

/**
 * Recurrence engine for saved routes (route templates).
 *
 * A saved route with a non-NONE recurrence + a `startDate` anchor + a crew is an
 * active recurring schedule: this fills the routes dashboard with PLANNED routes
 * for its upcoming occurrences. It's a pure function over an explicit tenant DB
 * client so it can be driven both by the request-scoped service (the "Run all"
 * button) and by the singleton cron (RouteSchedulerService) — which can't use a
 * request-scoped client.
 *
 * Idempotent: one route per (sourceTemplateId, plannedForDate). Re-running (e.g.
 * the daily cron) only creates the dates that don't exist yet, so a saved route
 * keeps generating until it's stopped (deleted).
 */

const MS_PER_DAY = 86_400_000;

/** Strip a timestamp to UTC midnight — the granularity plannedForDate uses. */
export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

/**
 * Occurrence dates (UTC date-only) for `recurrence` anchored at `start`, within
 * [rangeStart, rangeEnd] inclusive. NONE yields nothing (manual-run only).
 *   DAILY    — every day from the anchor
 *   WEEKLY   — same weekday as the anchor, every 7 days
 *   BIWEEKLY — every 14 days from the anchor
 *   MONTHLY  — same day-of-month as the anchor (clamped for short months)
 */
export function occurrencesInRange(
  recurrence: RouteRecurrence,
  start: Date,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  const out: Date[] = [];
  const anchor = dateOnly(start);
  const from = dateOnly(rangeStart);
  const to = dateOnly(rangeEnd);
  if (to < anchor || to < from) return out;

  const step = recurrence === 'DAILY' ? 1 : recurrence === 'WEEKLY' ? 7 : recurrence === 'BIWEEKLY' ? 14 : 0;
  if (step > 0) {
    // Align the first occurrence to the interval grid at or after max(anchor, from).
    const begin = from > anchor ? from : anchor;
    const daysSinceAnchor = Math.round((begin.getTime() - anchor.getTime()) / MS_PER_DAY);
    const offset = (step - (daysSinceAnchor % step)) % step;
    for (let d = addDays(begin, offset); d <= to; d = addDays(d, step)) out.push(d);
    return out;
  }

  if (recurrence === 'MONTHLY') {
    const dom = anchor.getUTCDate();
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    while (cursor <= to) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth();
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const occ = new Date(Date.UTC(year, month, Math.min(dom, lastDay)));
      if (occ >= anchor && occ >= from && occ <= to) out.push(occ);
      cursor.setUTCMonth(month + 1);
    }
    return out;
  }

  return out;
}

export interface GenerateOptions {
  /** How many days ahead to keep filled. Default 7 (a rolling week of PLANNED routes). */
  horizonDays?: number;
  /** Also create a today route for NONE-recurrence saved routes (the manual "Run all"). */
  includeNonRecurringToday?: boolean;
  /** Clock override for tests. */
  now?: Date;
}

/**
 * Materialize the due routes for one tenant's saved routes against `db` (its
 * tenant DB). Returns the number of routes created. Crew is taken from the saved
 * route; stops are already geocoded on the template, so they're copied as-is.
 */
export async function generateRoutesForTenant(
  db: PrismaClient,
  tenantId: string,
  opts: GenerateOptions = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const today = dateOnly(now);
  const rangeEnd = addDays(today, opts.horizonDays ?? 7);

  const templates = await db.routeTemplate.findMany({
    where: { tenantId },
    include: { stops: { orderBy: { sequence: 'asc' } }, assignees: true },
  });

  let created = 0;
  for (const tpl of templates) {
    const crew = [...new Set(tpl.assignees.map((a) => a.membershipId))];
    if (crew.length === 0 || tpl.stops.length === 0) continue; // nothing to assign / route

    const dates: Date[] = [];
    if (tpl.recurrence !== 'NONE' && tpl.startDate) {
      dates.push(...occurrencesInRange(tpl.recurrence, tpl.startDate, today, rangeEnd));
    }
    if (opts.includeNonRecurringToday && tpl.recurrence === 'NONE') {
      dates.push(today);
    }

    for (const date of dates) {
      if (await createOccurrence(db, tenantId, tpl, date)) created++;
    }
  }
  return created;
}

/** Template shape the occurrence creator needs (stops + crew). */
type TemplateForGen = {
  id: string;
  name: string;
  stops: Array<{ label: string; addressLine: string | null; city: string | null; state: string | null; postalCode: string | null; lat: number | null; lng: number | null; quoteRequestId: string | null }>;
  assignees: Array<{ membershipId: string }>;
};

/** Idempotently create one PLANNED WorkRoute for `tpl` on `date`. Returns true if created. */
async function createOccurrence(db: PrismaClient, tenantId: string, tpl: TemplateForGen, date: Date): Promise<boolean> {
  const crew = [...new Set(tpl.assignees.map((a) => a.membershipId))];
  if (crew.length === 0 || tpl.stops.length === 0) return false;
  const exists = await db.workRoute.findFirst({
    where: { tenantId, sourceTemplateId: tpl.id, plannedForDate: date },
    select: { id: true },
  });
  if (exists) return false;
  await db.workRoute.create({
    data: {
      tenantId,
      membershipId: crew[0]!, // primary assignee (mileage/gas + legacy)
      name: tpl.name,
      status: 'PLANNED',
      plannedForDate: date,
      sourceTemplateId: tpl.id,
      assignees: { create: crew.map((membershipId) => ({ tenantId, membershipId })) },
      stops: {
        create: tpl.stops.map((s, i) => ({
          tenantId,
          sequence: i,
          label: s.label,
          addressLine: s.addressLine,
          city: s.city,
          state: s.state,
          postalCode: s.postalCode,
          lat: s.lat,
          lng: s.lng,
          quoteRequestId: s.quoteRequestId,
        })),
      },
    },
  });
  return true;
}

/**
 * Guarantee a recurring saved route always has one upcoming PLANNED occurrence
 * (today or later, not yet completed), so its single "perpetual" row never
 * leaves the dashboard — even for monthly cadences beyond the cron's 7-day
 * horizon. Called on template create/update and after a recurring route is
 * completed (so it rolls forward to the next occurrence). No-op for NONE
 * recurrence / missing schedule / empty crew or stops. Returns true if created.
 */
export async function ensureNextOccurrence(
  db: PrismaClient,
  tenantId: string,
  templateId: string,
  opts: { now?: Date } = {},
): Promise<boolean> {
  const today = dateOnly(opts.now ?? new Date());
  const tpl = await db.routeTemplate.findFirst({
    where: { id: templateId, tenantId },
    include: { stops: { orderBy: { sequence: 'asc' } }, assignees: true },
  });
  if (!tpl || tpl.recurrence === 'NONE' || !tpl.startDate) return false;
  // Already an upcoming (>= today, not completed) occurrence? Nothing to do.
  const existingActive = await db.workRoute.findFirst({
    where: { tenantId, sourceTemplateId: tpl.id, status: { not: 'COMPLETED' }, plannedForDate: { gte: today } },
    select: { id: true },
  });
  if (existingActive) return false;
  // First occurrence at/after today, searching far enough to cover monthly.
  const occ = occurrencesInRange(tpl.recurrence, tpl.startDate, today, addDays(today, 400))[0];
  if (!occ) return false;
  return createOccurrence(db, tenantId, tpl, occ);
}
