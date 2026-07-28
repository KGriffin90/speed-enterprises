import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient, RouteRecurrence } from '@prisma/client';
import { TENANT_DB } from '../database/tenant-db.provider';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { hydrate, loadMembershipsByIds, loadUsersByIds } from '../database/cross-db';
import { geocodeAddress } from './geocode';
import { dateOnly, ensureNextOccurrence } from './route-generation';

// Haversine formula — returns distance in miles between two lat/lng points
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Same haversine, expressed in meters — the unit the stop geofence works in. */
function metersBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversine(lat1, lng1, lat2, lng2) * 1609.344;
}

// ── Geofenced stop check-in tuning ───────────────────────────────────────────
// Incoming GPS waypoints auto-stamp arrivedAt/departedAt on a route's stops, so
// per-stop "time on site" is derived from location with no manual taps.
const GEOFENCE_ENTER_M = 75;           // within this many m of a stop ⇒ ARRIVED
const GEOFENCE_EXIT_M = 120;           // must move beyond this from the on-site stop ⇒ DONE
                                       // (larger than ENTER so GPS jitter can't flap arrive/depart)
const GEOFENCE_MIN_DWELL_MS = 60_000;  // ignore a "departure" within the first minute on site
const GEOFENCE_MAX_ACCURACY_M = 100;   // ignore fixes less accurate than this — too noisy to trust
const GEOFENCE_STALE_PLANNED_MS = 86_400_000; // don't trigger a PLANNED route dated >1 day from the fix

/** Minimal shape the geofence needs from a stop (subset of RouteStop). */
interface GeoStop {
  id: string;
  status: string;
  lat: number | null;
  lng: number | null;
  arrivedAt: Date | null;
}

/** Address-only stop, as it arrives from the owner (route builder or template). */
interface StopInput {
  label: string;
  addressLine?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
  quoteRequestId?: string;
}

/**
 * Routes/waypoints/employee profiles are TENANT DB rows; memberships and the
 * users behind them are CATALOG rows. The two are stitched with `hydrate()`
 * rather than a Prisma `include`, since they live in different databases.
 */
@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    @Inject(TENANT_DB) private prisma: PrismaClient, // tenant DB (routes, waypoints, profiles)
    private catalog: CatalogPrismaService,           // control-plane (memberships, users)
  ) {}

  private async resolveMembership(tenantId: string, userId: string): Promise<string> {
    const m = await this.catalog.tenantMembership.findFirst({ where: { userId, tenantId, active: true } });
    if (!m) throw new NotFoundException('Membership not found');
    return m.id;
  }

  /** Keep only membership ids that exist + are active for this tenant (catalog DB). */
  private async validCrewIds(tenantId: string, ids?: string[]): Promise<string[]> {
    const unique = [...new Set(ids ?? [])];
    if (unique.length === 0) return [];
    const valid = await this.catalog.tenantMembership.findMany({
      where: { id: { in: unique }, tenantId, active: true },
      select: { id: true },
    });
    return unique.filter((id) => valid.some((v) => v.id === id));
  }

  /** Attach `membership: { fullName, user: { email } }` to rows carrying membershipId. */
  private async attachMembership<T extends { membershipId: string }>(rows: T[]) {
    const withMembership = await hydrate(rows, {
      keyOf: (r) => r.membershipId,
      as: 'membership',
      load: (ids) => loadMembershipsByIds(this.catalog, ids),
    });
    const userIds = withMembership
      .map((r) => r.membership?.userId)
      .filter((id): id is string => typeof id === 'string');
    const users = await loadUsersByIds(this.catalog, userIds, { email: true });
    return withMembership.map((r) => ({
      ...r,
      membership: r.membership
        ? { fullName: r.membership.fullName, user: { email: users.get(r.membership.userId)?.email ?? null } }
        : null,
    }));
  }

  // ── Staff ──────────────────────────────────────────────────────────────────

  async startRoute(tenantId: string, userId: string, timeEntryId?: string) {
    const membershipId = await this.resolveMembership(tenantId, userId);

    // If this staff member has a route scheduled for TODAY (or one already
    // running), track onto THAT route instead of spinning up a throwaway
    // mileage-log route. This keeps everything on one record: the GPS
    // breadcrumb, the derived mileage, AND the per-stop geofence check-ins all
    // land on the route the owner actually sees ("Monday Chipotle"), so the
    // web route detail shows the whole day in one place. We only fall back to a
    // fresh GPS-only route when there's nothing assigned for today (ad-hoc work).
    const todayStart = dateOnly(new Date());
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const assignedToday = await this.prisma.workRoute.findMany({
      where: {
        tenantId,
        status: { in: ['PLANNED', 'IN_PROGRESS'] },
        OR: [{ membershipId }, { assignees: { some: { membershipId } } }],
        plannedForDate: { gte: todayStart, lt: tomorrowStart },
      },
      orderBy: [{ plannedForDate: 'asc' }, { startedAt: 'asc' }],
    });
    // Prefer one already in progress (resume), else the first planned for today.
    const target = assignedToday.find((r) => r.status === 'IN_PROGRESS') ?? assignedToday[0];
    if (target) {
      return this.prisma.workRoute.update({
        where: { id: target.id },
        data: {
          status: 'IN_PROGRESS',
          startedAt: target.status === 'PLANNED' ? new Date() : target.startedAt,
          // Link the shift's time entry so mileage ties back to the clock-in.
          ...(timeEntryId ? { timeEntryId } : {}),
        },
      });
    }

    return this.prisma.workRoute.create({
      data: { tenantId, membershipId, timeEntryId: timeEntryId ?? null },
    });
  }

  async addWaypoint(
    tenantId: string,
    userId: string,
    routeId: string,
    wp: { lat: number; lng: number; accuracy?: number; speed?: number; heading?: number; altitude?: number; recordedAt: string },
  ) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    const route = await this.prisma.workRoute.findFirst({
      where: { id: routeId, tenantId, OR: [{ membershipId }, { assignees: { some: { membershipId } } }] },
    });
    if (!route) throw new NotFoundException();

    const recordedAt = new Date(wp.recordedAt);
    const waypoint = await this.prisma.routeWaypoint.create({
      data: {
        routeId,
        lat: wp.lat, lng: wp.lng,
        accuracy: wp.accuracy, speed: wp.speed,
        heading: wp.heading, altitude: wp.altitude,
        recordedAt,
      },
    });

    // Drive geofenced stop check-ins off this fix. Best-effort: a geofence error
    // must never fail waypoint ingestion (the location point is already saved).
    try {
      await this.applyGeofence(tenantId, membershipId, { lat: wp.lat, lng: wp.lng, accuracy: wp.accuracy, recordedAt });
    } catch (err) {
      this.logger.warn(`Geofence eval failed for route ${routeId}: ${err instanceof Error ? err.message : err}`);
    }

    return waypoint;
  }

  /**
   * Geofenced stop check-in. Given a staff member's latest GPS fix, auto-stamp
   * arrivedAt / departedAt on the stops of their active assigned route(s):
   *   • entering a PENDING stop's radius ⇒ ARRIVED (and a PLANNED route starts)
   *   • leaving the on-site stop's radius ⇒ DONE
   *
   * The fix usually arrives on the clock-in GPS route while the stops live on a
   * separate planned route, so we match by MEMBERSHIP, not by routeId.
   */
  private async applyGeofence(
    tenantId: string,
    membershipId: string,
    fix: { lat: number; lng: number; accuracy?: number; recordedAt: Date },
  ): Promise<void> {
    // A low-accuracy fix can land hundreds of meters off — never check anyone
    // in/out on one. (accuracy is the GPS error radius in meters.)
    if (fix.accuracy != null && fix.accuracy > GEOFENCE_MAX_ACCURACY_M) return;

    const routes = await this.prisma.workRoute.findMany({
      where: {
        tenantId,
        status: { in: ['PLANNED', 'IN_PROGRESS'] },
        OR: [{ membershipId }, { assignees: { some: { membershipId } } }],
        // Only routes that still have at least one open, geocoded stop.
        stops: { some: { lat: { not: null }, lng: { not: null }, status: { in: ['PENDING', 'ARRIVED'] } } },
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });

    for (const route of routes) {
      // A stale PLANNED route from another day shouldn't trigger on mere proximity.
      if (
        route.status === 'PLANNED' &&
        route.plannedForDate &&
        Math.abs(fix.recordedAt.getTime() - new Date(route.plannedForDate).getTime()) > GEOFENCE_STALE_PLANNED_MS
      ) {
        continue;
      }
      await this.evaluateRouteGeofence(route, fix);
    }
  }

  /** Run the arrive→depart state machine for one route against a single fix. */
  private async evaluateRouteGeofence(
    route: { id: string; status: string; stops: GeoStop[] },
    fix: { lat: number; lng: number; recordedAt: Date },
  ): Promise<void> {
    const geocoded = route.stops
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ id: s.id, status: s.status, arrivedAt: s.arrivedAt, lat: s.lat as number, lng: s.lng as number }));

    // 1) Departure — the on-site stop, once the fix is clearly outside its radius
    //    (and after a minimum dwell so a single noisy fix can't end the visit).
    const onSite = geocoded.find((s) => s.status === 'ARRIVED');
    let slotFree = !onSite;
    if (onSite) {
      const dist = metersBetween(fix.lat, fix.lng, onSite.lat, onSite.lng);
      const dwellMs = onSite.arrivedAt ? fix.recordedAt.getTime() - new Date(onSite.arrivedAt).getTime() : Infinity;
      if (dist > GEOFENCE_EXIT_M && dwellMs >= GEOFENCE_MIN_DWELL_MS) {
        await this.prisma.routeStop.update({ where: { id: onSite.id }, data: { status: 'DONE', departedAt: fix.recordedAt } });
        this.logger.log(`Geofence: departed stop ${onSite.id} on route ${route.id}`);
        slotFree = true;
      }
    }

    // 2) Arrival — nearest still-pending stop within the entry radius. Only one
    //    stop is "on site" at a time, so skip while still parked at one.
    if (!slotFree) return;
    const nearest = geocoded
      .filter((s) => s.status === 'PENDING')
      .map((s) => ({ s, dist: metersBetween(fix.lat, fix.lng, s.lat, s.lng) }))
      .filter((c) => c.dist <= GEOFENCE_ENTER_M)
      .sort((a, b) => a.dist - b.dist)[0];
    if (!nearest) return;

    // First arrival also flips a PLANNED route to IN_PROGRESS, stamping the real
    // start time (mirrors the manual arriveStop path).
    if (route.status === 'PLANNED') {
      await this.prisma.workRoute.update({
        where: { id: route.id },
        data: { status: 'IN_PROGRESS', startedAt: fix.recordedAt },
      });
    }
    await this.prisma.routeStop.update({
      where: { id: nearest.s.id },
      data: { status: 'ARRIVED', arrivedAt: fix.recordedAt, departedAt: null },
    });
    this.logger.log(`Geofence: arrived stop ${nearest.s.id} on route ${route.id} (${Math.round(nearest.dist)}m)`);
  }

  async endRoute(tenantId: string, userId: string, routeId: string, opts: { distanceMiles?: number } = {}) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    const route = await this.prisma.workRoute.findFirst({
      where: { id: routeId, tenantId, OR: [{ membershipId }, { assignees: { some: { membershipId } } }] },
      include: { waypoints: { orderBy: { recordedAt: 'asc' } } },
    });
    if (!route) throw new NotFoundException();

    // Mileage: a manual odometer entry wins; otherwise derive it from the GPS
    // breadcrumb trail. Gas follows from the employee's avg MPG.
    let distanceMiles: number | null = typeof opts.distanceMiles === 'number' ? opts.distanceMiles : null;
    if (distanceMiles === null) {
      const pts = route.waypoints;
      if (pts.length > 1) {
        distanceMiles = 0;
        for (let i = 1; i < pts.length; i++) {
          distanceMiles += haversine(pts[i - 1]!.lat, pts[i - 1]!.lng, pts[i]!.lat, pts[i]!.lng);
        }
      }
    }

    const profile = await this.prisma.employeeProfile.findFirst({ where: { membershipId } });
    const mpg = profile?.avgMpg ?? 25;
    const gallonsUsed = distanceMiles !== null ? distanceMiles / mpg : null;

    const endedAt = new Date();
    // Finishing the route means you've left the last job — close out the stop
    // that's still "on site" so its departure time and on-site minutes aren't
    // left blank (the final stop never gets a drive-away GPS fix to depart it).
    await this.prisma.routeStop.updateMany({
      where: { routeId, status: 'ARRIVED' },
      data: { status: 'DONE', departedAt: endedAt },
    });
    const completed = await this.prisma.workRoute.update({
      where: { id: routeId },
      data: { endedAt, status: 'COMPLETED', distanceMiles, gallonsUsed },
    });
    // A recurring route just finished today → roll it forward so its single
    // "perpetual" row reappears as PLANNED for the next occurrence.
    if (completed.sourceTemplateId) {
      await ensureNextOccurrence(this.prisma, tenantId, completed.sourceTemplateId).catch(() => {});
    }
    return completed;
  }

  async listMine(tenantId: string, userId: string, limit = 30) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    return this.prisma.workRoute.findMany({
      where: { tenantId, membershipId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { _count: { select: { waypoints: true } } },
    });
  }

  async getRoute(tenantId: string, userId: string, routeId: string) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    const route = await this.prisma.workRoute.findFirst({
      where: { id: routeId, tenantId, membershipId },
      include: { waypoints: { orderBy: { recordedAt: 'asc' } } },
    });
    if (!route) throw new NotFoundException();
    return route;
  }

  /** A staff member's planned/active routes (the ones they work stop-by-stop). */
  async listAssigned(tenantId: string, userId: string) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    const routes = await this.prisma.workRoute.findMany({
      where: {
        tenantId,
        status: { in: ['PLANNED', 'IN_PROGRESS'] },
        // Primary assignee (legacy) OR a crew member.
        OR: [{ membershipId }, { assignees: { some: { membershipId } } }],
      },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        _count: { select: { waypoints: true } },
      },
      orderBy: [{ plannedForDate: 'asc' }, { startedAt: 'asc' }],
    });
    // Per-stop arrival/departure timing is OWNER-ONLY. Staff get the stop list
    // (addresses + current/next status) but never the timestamps or durations.
    return routes.map((r) => ({
      ...r,
      stops: r.stops.map(({ arrivedAt: _a, departedAt: _d, ...stop }) => stop),
    }));
  }

  /** Staff starts a planned route: flips it to IN_PROGRESS and stamps startedAt. */
  async startPlannedRoute(tenantId: string, userId: string, routeId: string) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    const route = await this.prisma.workRoute.findFirst({
      where: { id: routeId, tenantId, OR: [{ membershipId }, { assignees: { some: { membershipId } } }] },
    });
    if (!route) throw new NotFoundException();
    return this.prisma.workRoute.update({
      where: { id: routeId },
      data: { status: 'IN_PROGRESS', startedAt: route.status === 'PLANNED' ? new Date() : route.startedAt },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });
  }

  private async assertOwnedStop(tenantId: string, userId: string, routeId: string, stopId: string) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    const stop = await this.prisma.routeStop.findFirst({
      where: { id: stopId, routeId, route: { tenantId, OR: [{ membershipId }, { assignees: { some: { membershipId } } }] } },
    });
    if (!stop) throw new NotFoundException();
    return membershipId;
  }

  /** Staff arrives on site at a stop — starts the on-site clock for this job. */
  async arriveStop(tenantId: string, userId: string, routeId: string, stopId: string) {
    await this.assertOwnedStop(tenantId, userId, routeId, stopId);
    // First arrival also kicks the route into IN_PROGRESS if it was still PLANNED.
    await this.prisma.workRoute.updateMany({
      where: { id: routeId, tenantId, status: 'PLANNED' },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
    return this.prisma.routeStop.update({
      where: { id: stopId },
      data: { status: 'ARRIVED', arrivedAt: new Date(), departedAt: null },
    });
  }

  /** Staff completes a stop and heads to the next — stops the on-site clock. */
  async departStop(tenantId: string, userId: string, routeId: string, stopId: string) {
    await this.assertOwnedStop(tenantId, userId, routeId, stopId);
    return this.prisma.routeStop.update({
      where: { id: stopId },
      data: { status: 'DONE', departedAt: new Date() },
    });
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  /**
   * Fill in lat/lng for stops that have an address but no explicit coordinates,
   * so the GPS geofence has something to match against. Best-effort and serial
   * (Nominatim prefers low, sequential volume); a stop that can't be resolved
   * just keeps null coords and is silently skipped by the geofence.
   */
  private async geocodeStops<T extends { addressLine?: string; city?: string; state?: string; postalCode?: string; lat?: number; lng?: number }>(
    stops: T[],
  ): Promise<T[]> {
    const out: T[] = [];
    for (const s of stops) {
      if (s.lat != null && s.lng != null) { out.push(s); continue; } // explicit coords win
      const geo = await geocodeAddress(s);
      out.push(geo ? { ...s, lat: geo.lat, lng: geo.lng } : s);
    }
    return out;
  }

  /** Owner builds a route: assigns it to a staff member and lays out the stops. */
  async createPlannedRoute(tenantId: string, ownerUserId: string, dto: {
    name?: string;
    membershipId?: string;        // legacy single-assignee field (still accepted)
    membershipIds?: string[];     // crew: one or more assigned staff
    plannedForDate?: string;
    sourceTemplateId?: string;    // set when generated from a saved route (dedupe key)
    stops: Array<{ label: string; addressLine?: string; city?: string; state?: string; postalCode?: string; lat?: number; lng?: number; quoteRequestId?: string }>;
  }) {
    // Accept either a list (crew) or the legacy single id. De-dupe, preserve order.
    const ids = [...new Set([...(dto.membershipIds ?? []), ...(dto.membershipId ? [dto.membershipId] : [])])];
    if (ids.length === 0) throw new NotFoundException('At least one staff member must be assigned');

    const valid = await this.catalog.tenantMembership.findMany({ where: { id: { in: ids }, tenantId, active: true }, select: { id: true } });
    const validIds = ids.filter((id) => valid.some((v) => v.id === id));
    if (validIds.length === 0) throw new NotFoundException('No valid assigned staff members found');

    const assignedById = await this.resolveMembership(tenantId, ownerUserId).catch(() => null);
    const stopInputs = await this.geocodeStops(dto.stops ?? []);
    const route = await this.prisma.workRoute.create({
      data: {
        tenantId,
        membershipId: validIds[0]!,   // primary assignee (mileage/gas + legacy)
        assignedById: assignedById ?? undefined,
        name: dto.name?.trim() || null,
        status: 'PLANNED',
        plannedForDate: dto.plannedForDate ? new Date(dto.plannedForDate) : null,
        sourceTemplateId: dto.sourceTemplateId ?? null,
        assignees: { create: validIds.map((membershipId) => ({ tenantId, membershipId })) },
        stops: {
          create: stopInputs.map((s, i) => ({
            tenantId,
            sequence: i,
            label: s.label,
            addressLine: s.addressLine ?? null,
            city: s.city ?? null,
            state: s.state ?? null,
            postalCode: s.postalCode ?? null,
            lat: s.lat ?? null,
            lng: s.lng ?? null,
            quoteRequestId: s.quoteRequestId ?? null,
          })),
        },
      },
      include: { stops: { orderBy: { sequence: 'asc' } }, assignees: true },
    });
    const [withMembership] = await this.attachMembership([route]);
    return withMembership;
  }

  /// Owner edits a planned route. Name/date are editable any time; crew and the
  /// stop list can only be changed while the route is still PLANNED (once a staff
  /// member has started it, the stops carry live arrival/departure timing we
  /// must not destroy).
  async updatePlannedRoute(tenantId: string, routeId: string, dto: {
    name?: string;
    membershipIds?: string[];
    plannedForDate?: string;
    stops?: Array<{ label: string; addressLine?: string; city?: string; state?: string; postalCode?: string; lat?: number; lng?: number; quoteRequestId?: string }>;
  }) {
    const route = await this.prisma.workRoute.findFirst({ where: { id: routeId, tenantId } });
    if (!route) throw new NotFoundException();

    const editingStructure = dto.membershipIds !== undefined || dto.stops !== undefined;
    if (editingStructure && route.status !== 'PLANNED') {
      throw new BadRequestException('Crew and stops can only be edited while the route is still planned (not started).');
    }

    // Validate the crew (memberships live in the catalog DB) if it's changing.
    let validIds: string[] | undefined;
    if (dto.membershipIds !== undefined) {
      const ids = [...new Set(dto.membershipIds)];
      if (ids.length === 0) throw new BadRequestException('At least one staff member must be assigned');
      const valid = await this.catalog.tenantMembership.findMany({ where: { id: { in: ids }, tenantId, active: true }, select: { id: true } });
      validIds = ids.filter((id) => valid.some((v) => v.id === id));
      if (validIds.length === 0) throw new NotFoundException('No valid assigned staff members found');
    }

    // Geocode outside the transaction — network I/O must not hold a DB tx open.
    const geocodedStops = dto.stops !== undefined ? await this.geocodeStops(dto.stops) : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.workRoute.update({
        where: { id: routeId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() || null } : {}),
          ...(dto.plannedForDate !== undefined ? { plannedForDate: dto.plannedForDate ? new Date(dto.plannedForDate) : null } : {}),
          ...(validIds ? { membershipId: validIds[0]! } : {}),  // keep primary assignee in sync
        },
      });
      if (validIds) {
        await tx.routeAssignee.deleteMany({ where: { routeId } });
        await tx.routeAssignee.createMany({ data: validIds.map((membershipId) => ({ tenantId, routeId, membershipId })) });
      }
      if (geocodedStops !== undefined) {
        await tx.routeStop.deleteMany({ where: { routeId } });
        await tx.routeStop.createMany({
          data: geocodedStops.map((s, i) => ({
            tenantId, routeId, sequence: i, label: s.label,
            addressLine: s.addressLine ?? null, city: s.city ?? null, state: s.state ?? null,
            postalCode: s.postalCode ?? null, lat: s.lat ?? null, lng: s.lng ?? null,
            quoteRequestId: s.quoteRequestId ?? null,
          })),
        });
      }
    });

    return this.adminGetRoute(tenantId, routeId);
  }

  async deletePlannedRoute(tenantId: string, routeId: string) {
    const route = await this.prisma.workRoute.findFirst({ where: { id: routeId, tenantId } });
    if (!route) throw new NotFoundException();
    await this.prisma.workRoute.delete({ where: { id: routeId } });
    return { ok: true };
  }

  /**
   * Routes dashboard list, bucketed into display **phases** derived from
   * status + plannedForDate (today, UTC date-only — matching generation):
   *   - completed: status COMPLETED/CANCELED (history)
   *   - active:    status IN_PROGRESS — at least one assigned employee has
   *                started the route, so GPS tracking is live
   *   - running:   PLANNED and scheduled for today (or overdue) — the "En route"
   *                day-of state, before any staff member begins it
   *   - planned:   PLANNED and scheduled in the future
   * Recurring routes (sourceTemplateId set) collapse to ONE perpetual row — the
   * earliest non-completed occurrence — so a weekly route shows a single
   * Planned↔En-route entry; its finished runs live only under `completed`.
   */
  async listAll(tenantId: string, opts: { membershipId?: string; phase?: string; from?: string; to?: string } = {}) {
    // Optional inclusive day window (used by the workforce weekly summary). The
    // phase dashboard sends no window so future PLANNED routes still show.
    const fromD = opts.from ? new Date(opts.from) : undefined;
    const toD = opts.to ? new Date(new Date(opts.to).getTime() + 86_400_000 - 1) : undefined;
    const inRange = (field: 'startedAt' | 'plannedForDate') => ({
      [field]: { ...(fromD ? { gte: fromD } : {}), ...(toD ? { lte: toD } : {}) },
    });
    const routes = await this.prisma.workRoute.findMany({
      where: {
        tenantId,
        ...(opts.membershipId ? { membershipId: opts.membershipId } : {}),
        ...(fromD || toD ? { OR: [inRange('startedAt'), inRange('plannedForDate')] } : {}),
      },
      include: {
        _count: { select: { waypoints: true, stops: true, assignees: true } },
        assignees: { select: { membershipId: true } },
      },
      orderBy: { plannedForDate: 'asc' },
    });

    // "Live" means someone is actually on the clock right now. A started route
    // whose crew has all clocked out is no longer live — it drops back to
    // En route rather than showing a green dot with nobody working.
    const clockedIn = new Set(
      (await this.prisma.timeEntry.findMany({
        where: { tenantId, status: 'ACTIVE', clockedOutAt: null },
        select: { membershipId: true },
      })).map((t) => t.membershipId),
    );

    const today = dateOnly(new Date()).getTime();
    const phaseOf = (r: (typeof routes)[number]): 'planned' | 'running' | 'active' | 'completed' => {
      if (r.status === 'COMPLETED' || r.status === 'CANCELED') return 'completed';
      // Started AND at least one of its crew is clocked in → GPS tracking is live.
      if (r.status === 'IN_PROGRESS') {
        const crew = [r.membershipId, ...r.assignees.map((a) => a.membershipId)];
        return crew.some((m) => clockedIn.has(m)) ? 'active' : 'running';
      }
      if (r.plannedForDate) {
        const d = dateOnly(new Date(r.plannedForDate)).getTime();
        return d > today ? 'planned' : 'running'; // today or overdue ⇒ En route (not started yet)
      }
      return r.endedAt ? 'completed' : 'active'; // GPS-log route fallback
    };
    const withPhase = routes.map((r) => ({ ...r, phase: phaseOf(r) }));

    // Legacy callers (no `phase` — e.g. the workforce weekly summary) get the
    // flat, date-windowed list, newest first, with no recurring-collapse.
    if (opts.phase === undefined) {
      const sorted = [...withPhase].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      return this.attachMembership(sorted);
    }

    // Dashboard view: collapse recurring occurrences to the earliest non-completed
    // row per template, keep all completed rows as history, then filter by phase.
    const seenTemplate = new Set<string>();
    const activeRows = withPhase
      .filter((r) => r.phase !== 'completed')
      .filter((r) => {
        if (!r.sourceTemplateId) return true;
        if (seenTemplate.has(r.sourceTemplateId)) return false;
        seenTemplate.add(r.sourceTemplateId);
        return true;
      });
    const completed = withPhase
      .filter((r) => r.phase === 'completed')
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    let result = [...activeRows, ...completed];
    if (opts.phase !== 'all') result = result.filter((r) => r.phase === opts.phase);

    // attachMembership spreads each row, so the `phase` tag is preserved.
    return this.attachMembership(result);
  }

  async adminGetRoute(tenantId: string, routeId: string) {
    const route = await this.prisma.workRoute.findFirst({
      where: { id: routeId, tenantId },
      include: {
        waypoints: { orderBy: { recordedAt: 'desc' }, take: 1 }, // latest GPS fix only
        _count: { select: { waypoints: true } },
        stops: { orderBy: { sequence: 'asc' } },
        assignees: true,
      },
    });
    if (!route) throw new NotFoundException();
    const [withMembership] = await this.attachMembership([route]);

    // Resolve the crew's names/emails (memberships + users live in the catalog).
    const members = await this.catalog.tenantMembership.findMany({
      where: { id: { in: route.assignees.map((a) => a.membershipId) } },
      select: { id: true, fullName: true, userId: true },
    });
    const users = await loadUsersByIds(this.catalog, members.map((m) => m.userId), { email: true });
    const crew = route.assignees.map((a) => {
      const m = members.find((x) => x.id === a.membershipId);
      return { membershipId: a.membershipId, fullName: m?.fullName ?? null, email: m ? (users.get(m.userId)?.email ?? null) : null };
    });

    // Per-stop timing: time-on-site (arrived→departed) and drive time from the
    // previous stop (prev.departed→this.arrived) — the data the owner wants.
    const stops = route.stops.map((s, i) => {
      const prev = i > 0 ? route.stops[i - 1] : null;
      const mins = (a?: Date | null, b?: Date | null) =>
        a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : null;
      return {
        ...s,
        onSiteMinutes: mins(s.arrivedAt, s.departedAt),
        driveMinutesFromPrev: mins(prev?.departedAt ?? null, s.arrivedAt),
      };
    });
    return { ...withMembership, stops, crew };
  }

  // ── Route templates (owner) ──────────────────────────────────────────────────
  // A template is a named, reusable stop list. The owner saves it once, then
  // clones it into a working PLANNED route (assign staff + pick a date) each day.

  async listTemplates(tenantId: string) {
    return this.prisma.routeTemplate.findMany({
      where: { tenantId },
      include: { _count: { select: { stops: true } }, assignees: true },
      orderBy: { name: 'asc' },
    });
  }

  async getTemplate(tenantId: string, templateId: string) {
    const tpl = await this.prisma.routeTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: { stops: { orderBy: { sequence: 'asc' } }, assignees: true },
    });
    if (!tpl) throw new NotFoundException();
    return tpl;
  }

  async createTemplate(tenantId: string, ownerUserId: string, dto: { name?: string; stops?: StopInput[]; recurrence?: RouteRecurrence; membershipIds?: string[]; startDate?: string | null }) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Template name is required');
    const createdById = await this.resolveMembership(tenantId, ownerUserId).catch(() => null);
    const stops = await this.geocodeStops(dto.stops ?? []);
    const crewIds = await this.validCrewIds(tenantId, dto.membershipIds);
    const created = await this.prisma.routeTemplate.create({
      data: {
        tenantId,
        name,
        recurrence: dto.recurrence ?? RouteRecurrence.NONE,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        createdById: createdById ?? undefined,
        assignees: { create: crewIds.map((membershipId) => ({ tenantId, membershipId })) },
        stops: {
          create: stops.map((s, i) => ({
            tenantId, sequence: i, label: s.label,
            addressLine: s.addressLine ?? null, city: s.city ?? null, state: s.state ?? null,
            postalCode: s.postalCode ?? null, lat: s.lat ?? null, lng: s.lng ?? null,
            quoteRequestId: s.quoteRequestId ?? null,
          })),
        },
      },
      include: { stops: { orderBy: { sequence: 'asc' } }, assignees: true },
    });
    // Recurring saved route → materialize its next occurrence so it shows on the
    // dashboard right away (and the perpetual row never gaps).
    await ensureNextOccurrence(this.prisma, tenantId, created.id).catch(() => {});
    return created;
  }

  async updateTemplate(tenantId: string, templateId: string, dto: { name?: string; stops?: StopInput[]; recurrence?: RouteRecurrence; membershipIds?: string[]; startDate?: string | null }) {
    const tpl = await this.prisma.routeTemplate.findFirst({ where: { id: templateId, tenantId } });
    if (!tpl) throw new NotFoundException();
    const geocoded = dto.stops !== undefined ? await this.geocodeStops(dto.stops) : undefined;
    const crewIds = dto.membershipIds !== undefined ? await this.validCrewIds(tenantId, dto.membershipIds) : undefined;
    await this.prisma.$transaction(async (tx) => {
      const data: { name?: string; recurrence?: RouteRecurrence; startDate?: Date | null } = {};
      if (dto.name !== undefined && dto.name.trim()) data.name = dto.name.trim();
      if (dto.recurrence !== undefined) data.recurrence = dto.recurrence;
      if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
      if (Object.keys(data).length > 0) {
        await tx.routeTemplate.update({ where: { id: templateId }, data });
      }
      if (geocoded !== undefined) {
        await tx.routeTemplateStop.deleteMany({ where: { templateId } });
        await tx.routeTemplateStop.createMany({
          data: geocoded.map((s, i) => ({
            templateId, tenantId, sequence: i, label: s.label,
            addressLine: s.addressLine ?? null, city: s.city ?? null, state: s.state ?? null,
            postalCode: s.postalCode ?? null, lat: s.lat ?? null, lng: s.lng ?? null,
            quoteRequestId: s.quoteRequestId ?? null,
          })),
        });
      }
      if (crewIds !== undefined) {
        await tx.routeTemplateAssignee.deleteMany({ where: { templateId } });
        if (crewIds.length > 0) {
          await tx.routeTemplateAssignee.createMany({
            data: crewIds.map((membershipId) => ({ templateId, tenantId, membershipId })),
          });
        }
      }
    });
    // Schedule/crew/stops may have changed → re-ensure the next occurrence.
    await ensureNextOccurrence(this.prisma, tenantId, templateId).catch(() => {});
    return this.getTemplate(tenantId, templateId);
  }

  async deleteTemplate(tenantId: string, templateId: string) {
    const tpl = await this.prisma.routeTemplate.findFirst({ where: { id: templateId, tenantId } });
    if (!tpl) throw new NotFoundException();
    await this.prisma.routeTemplate.delete({ where: { id: templateId } });
    return { ok: true };
  }

  /** Map a stored stop (RouteStop / RouteTemplateStop) to a StopInput for cloning. */
  private toStopInput(s: { label: string; addressLine: string | null; city: string | null; state: string | null; postalCode: string | null; lat: number | null; lng: number | null; quoteRequestId: string | null }): StopInput {
    return {
      label: s.label,
      addressLine: s.addressLine ?? undefined, city: s.city ?? undefined, state: s.state ?? undefined,
      postalCode: s.postalCode ?? undefined, lat: s.lat ?? undefined, lng: s.lng ?? undefined,
      quoteRequestId: s.quoteRequestId ?? undefined,
    };
  }

  /** Clone a template into a fresh working PLANNED route (assign staff + date). */
  async createRouteFromTemplate(tenantId: string, ownerUserId: string, dto: {
    templateId: string; membershipId?: string; membershipIds?: string[]; plannedForDate?: string; name?: string;
  }) {
    const tpl = await this.getTemplate(tenantId, dto.templateId);
    // Fall back to the saved route's own crew when the caller didn't pick staff.
    const fallbackCrew = tpl.assignees.map((a) => a.membershipId);
    // Stops are already geocoded on the template, so createPlannedRoute skips the
    // geocode round-trip (explicit lat/lng win).
    return this.createPlannedRoute(tenantId, ownerUserId, {
      name: dto.name ?? tpl.name,
      membershipId: dto.membershipId,
      membershipIds: (dto.membershipIds && dto.membershipIds.length) ? dto.membershipIds : fallbackCrew,
      plannedForDate: dto.plannedForDate,
      sourceTemplateId: tpl.id,
      stops: tpl.stops.map((s) => this.toStopInput(s)),
    });
  }

  /** Save an existing route's stop list as a reusable named template. */
  async saveRouteAsTemplate(tenantId: string, ownerUserId: string, routeId: string, name?: string) {
    const route = await this.prisma.workRoute.findFirst({
      where: { id: routeId, tenantId },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });
    if (!route) throw new NotFoundException();
    return this.createTemplate(tenantId, ownerUserId, {
      name: name ?? route.name ?? 'Saved route',
      stops: route.stops.map((s) => this.toStopInput(s)),
    });
  }
}
