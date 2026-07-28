import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { MessagingService } from '../messaging/messaging.service';
import { Prisma, AuditAction, AppointmentMode, AppointmentStatus } from '@prisma/client';
import type { Scheduling } from '@speed-enterprises/shared';
import * as crypto from 'crypto';
import { DateTime } from 'luxon';

const HOLD_TTL_MINUTES = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/** Parse "HH:MM" → { hour, minute } */
function parseTime(t: string): { hour: number; minute: number } {
  const [h, m] = t.split(':').map(Number);
  return { hour: h!, minute: m! };
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Singleton (it owns @Cron jobs), so it never injects the request-scoped
 * TENANT_DB. Instead it resolves the right per-tenant client on demand via
 * TenantDatabaseService.clientFor(tenantId).
 *
 * Appointments/holds/quotes/config live in each tenant's database; user emails
 * live in the CATALOG. Public token routes (cancel/reschedule/confirm) don't
 * know their tenant up front, so `scanTenants` walks active tenants to find the
 * row. In pool mode every clientFor() returns the same shared client, so the
 * scan resolves on the first tenant; in db-per-tenant it stops at the owner.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private catalog: CatalogPrismaService,
    private tenantDb: TenantDatabaseService,
    private messaging: MessagingService,
  ) {}

  private db(tenantId: string): Promise<PrismaClient> {
    return this.tenantDb.clientFor(tenantId);
  }

  private async emailFor(userId: string | null | undefined): Promise<string | undefined> {
    if (!userId) return undefined;
    const u = await this.catalog.user.findUnique({ where: { id: userId }, select: { email: true } });
    return u?.email;
  }

  /** Walk active tenants until `fn` returns a row; used for public token lookups. */
  private async scanTenants<T>(
    fn: (db: PrismaClient, tenantId: string) => Promise<T | null>,
  ): Promise<{ tenantId: string; db: PrismaClient; value: T } | null> {
    const tenants = await this.catalog.tenant.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      select: { id: true },
    });
    for (const t of tenants) {
      const db = await this.db(t.id);
      const value = await fn(db, t.id);
      if (value) return { tenantId: t.id, db, value };
    }
    return null;
  }

  // ── Availability ──────────────────────────────────────────────────────────

  /**
   * Returns the next `limit` open slots for a tenant, starting from `from`.
   *
   * Real availability = operating hours + blackout dates + buffer minutes
   * between jobs + max concurrent capacity + existing appointments + active holds.
   */
  async getAvailableSlots(
    tenantId: string,
    durationMinutes: number,
    from: Date,
    limit = 8,
  ): Promise<Array<{ startAt: Date; endAt: Date; label: string }>> {
    const db = await this.db(tenantId);
    const cfg = await this.loadSchedulingConfig(db, tenantId);
    const tz  = cfg.timezone;

    const horizon = DateTime.now().setZone(tz).plus({ days: cfg.bookingHorizonDays });
    const leadMs  = cfg.bookingLeadTimeHours * 60 * 60_000;
    const earliest = new Date(Math.max(from.getTime(), Date.now() + leadMs));

    const windowEnd = horizon.toJSDate();
    const [existingAppts, activeHolds] = await Promise.all([
      db.appointment.findMany({
        where: {
          tenantId,
          status: { notIn: [AppointmentStatus.CANCELED, AppointmentStatus.RESCHEDULED] },
          startAt: { gte: earliest, lte: windowEnd },
        },
        select: { startAt: true, endAt: true },
      }),
      db.slotHold.findMany({
        where: {
          tenantId,
          heldUntil: { gt: new Date() },
          startAt: { gte: earliest, lte: windowEnd },
        },
        select: { startAt: true, endAt: true },
      }),
    ]);

    const blocked = [...existingAppts, ...activeHolds].map(r => ({
      start: r.startAt!.getTime(),
      end:   r.endAt!.getTime(),
    }));

    const slots: Array<{ startAt: Date; endAt: Date; label: string }> = [];
    const dayKeys = ['sun','mon','tue','wed','thu','fri','sat'] as const;

    let cursor = DateTime.fromJSDate(earliest, { zone: tz });
    let safety = 0;

    while (slots.length < limit && cursor < horizon && safety++ < 10_000) {
      const dayKey = dayKeys[cursor.weekday % 7]!;
      const hours  = cfg.operatingHours[dayKey];

      if (!hours || hours === 'closed') {
        cursor = cursor.plus({ days: 1 }).startOf('day');
        continue;
      }

      const dateStr = cursor.toISODate()!;
      if ((cfg.blackoutDates ?? []).includes(dateStr)) {
        cursor = cursor.plus({ days: 1 }).startOf('day');
        continue;
      }

      const open  = parseTime(hours.open);
      const close = parseTime(hours.close);
      const snap  = cfg.slotDurationMinutes;

      const dayStart = cursor.set({ hour: open.hour,  minute: open.minute,  second: 0, millisecond: 0 });
      const dayEnd   = cursor.set({ hour: close.hour, minute: close.minute, second: 0, millisecond: 0 });

      let slotStart = cursor < dayStart ? dayStart : cursor;
      const minsIntoDay = slotStart.diff(dayStart, 'minutes').minutes;
      const snapped = Math.ceil(minsIntoDay / snap) * snap;
      slotStart = dayStart.plus({ minutes: snapped });

      if (slotStart >= dayEnd) {
        cursor = cursor.plus({ days: 1 }).startOf('day');
        continue;
      }

      const slotEnd = slotStart.plus({ minutes: durationMinutes + (cfg.bufferMinutes ?? 15) });

      if (slotEnd > dayEnd) {
        cursor = cursor.plus({ days: 1 }).startOf('day');
        continue;
      }

      const startMs = slotStart.toMillis();
      const endMs   = slotEnd.toMillis();

      const concurrentCount = blocked.filter(b => b.start < endMs && b.end > startMs).length;
      const maxConcurrent   = cfg.maxConcurrentJobs ?? 1;

      if (concurrentCount < maxConcurrent) {
        const label = slotStart.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);
        slots.push({ startAt: slotStart.toJSDate(), endAt: slotEnd.toJSDate(), label });
      }

      cursor = slotStart.plus({ minutes: snap });
    }

    return slots;
  }

  // ── Self-serve flow ───────────────────────────────────────────────────────

  async holdSlot(
    tenantId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<{ holdToken: string; expiresAt: Date }> {
    const db = await this.db(tenantId);
    const heldUntil  = new Date(Date.now() + HOLD_TTL_MINUTES * 60_000);
    const holdToken  = randomToken();

    try {
      await db.slotHold.create({
        data: { tenantId, startAt, endAt, heldUntil, holdToken },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('That slot was just taken. Please pick another time.');
      }
      throw err;
    }

    return { holdToken, expiresAt: heldUntil };
  }

  async confirmSelfServe(
    tenantId: string,
    holdToken: string,
    quoteRequestId: string,
    userId: string | null,
    customerTimezone: string,
  ): Promise<{ appointment: any }> {
    const db = await this.db(tenantId);
    const hold = await db.slotHold.findUnique({ where: { holdToken } });

    if (!hold || hold.tenantId !== tenantId) throw new NotFoundException('Booking link not found.');
    if (hold.heldUntil < new Date()) {
      await db.slotHold.delete({ where: { holdToken } }).catch(() => {});
      throw new BadRequestException('Your hold expired. Please pick a new time slot.');
    }

    const quote = await db.quoteRequest.findFirst({
      where: { id: quoteRequestId, tenantId },
      include: { service: true },
    });
    if (!quote) throw new NotFoundException('Quote not found.');

    const cfg      = await this.loadSchedulingConfig(db, tenantId);
    const duration = quote.service.estimatedDurationMinutes ?? 60;

    await this.assertNoOverlap(db, tenantId, hold.startAt, hold.endAt);

    const rescheduleToken = randomToken();
    const cancelToken     = randomToken();

    const [appointment] = await db.$transaction([
      db.appointment.create({
        data: {
          tenantId,
          quoteRequestId,
          userId,
          mode:             AppointmentMode.SELF_SERVE,
          status:           AppointmentStatus.CONFIRMED,
          startAt:          hold.startAt,
          endAt:            hold.endAt,
          durationMinutes:  duration,
          businessTimezone: cfg.timezone,
          customerTimezone,
          rescheduleToken,
          cancelToken,
        },
      }),
      db.quoteRequest.update({
        where: { id: quoteRequestId },
        data:  { status: 'SCHEDULED', scheduledAt: hold.startAt },
      }),
      db.slotHold.delete({ where: { holdToken } }),
      db.auditLog.create({
        data: {
          tenantId,
          actorUserId: userId ?? null,
          action:      AuditAction.APPOINTMENT_CREATED,
          entityType:  'Appointment',
          entityId:    quoteRequestId,
          metadata:    { mode: 'SELF_SERVE', startAt: hold.startAt } as any,
        },
      }),
    ]);

    await this.sendConfirmation(tenantId, appointment as any);
    return { appointment };
  }

  // ── Propose-slots flow ────────────────────────────────────────────────────

  async proposeSlots(
    tenantId: string,
    quoteRequestId: string,
    actorId: string,
    windows: Array<{ startAt: string; endAt: string }>,
  ): Promise<{ appointment: any }> {
    if (windows.length < 1 || windows.length > 3) {
      throw new BadRequestException('Propose 1–3 windows.');
    }

    const db = await this.db(tenantId);
    const quote = await db.quoteRequest.findFirst({
      where: { id: quoteRequestId, tenantId },
      include: { service: true },
    });
    if (!quote) throw new NotFoundException('Quote not found.');

    const cfg = await this.loadSchedulingConfig(db, tenantId);

    const parsedWindows = windows.map(w => ({
      startAt: new Date(w.startAt),
      endAt:   new Date(w.endAt),
      label:   DateTime.fromISO(w.startAt, { zone: cfg.timezone })
        .toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY),
    }));

    for (const w of parsedWindows) {
      try {
        await db.slotHold.create({
          data: {
            tenantId,
            startAt:   w.startAt,
            endAt:     w.endAt,
            heldUntil: new Date(Date.now() + 72 * 3600_000), // 72h for proposals
            holdToken:  randomToken(),
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictException(
            `The window starting ${w.label} is already held. Pick a different time.`,
          );
        }
        throw err;
      }
    }

    const bookingToken    = randomToken();
    const rescheduleToken = randomToken();
    const cancelToken     = randomToken();
    const duration = quote.service.estimatedDurationMinutes ?? 120;

    const appointment = await db.appointment.create({
      data: {
        tenantId,
        quoteRequestId,
        userId:           quote.userId,
        mode:             AppointmentMode.PROPOSED,
        status:           AppointmentStatus.PROPOSED,
        durationMinutes:  duration,
        businessTimezone: cfg.timezone,
        customerTimezone: cfg.timezone, // overwritten when customer confirms
        bookingToken,
        rescheduleToken,
        cancelToken,
        proposedSlots: parsedWindows as any,
      },
    });

    await db.auditLog.create({
      data: {
        tenantId,
        actorUserId: actorId,
        action:      AuditAction.APPOINTMENT_CREATED,
        entityType:  'Appointment',
        entityId:    quoteRequestId,
        metadata:    { mode: 'PROPOSED', windows: parsedWindows.length } as any,
      },
    });

    await this.sendProposalEmail(tenantId, appointment as any);
    return { appointment };
  }

  async confirmProposed(
    appointmentId: string,
    tenantId: string | null,
    selectedIndex: number,
    customerTimezone: string,
  ): Promise<{ appointment: any }> {
    // tenantId is null on the public one-click email path; locate the owner DB.
    let db: PrismaClient;
    if (tenantId) {
      db = await this.db(tenantId);
    } else {
      const found = await this.scanTenants((c) =>
        c.appointment.findFirst({ where: { id: appointmentId, status: AppointmentStatus.PROPOSED } }),
      );
      if (!found) throw new NotFoundException('Proposal not found or already confirmed.');
      tenantId = found.tenantId;
      db = found.db;
    }

    const appt = await db.appointment.findFirst({
      where: { id: appointmentId, tenantId, status: AppointmentStatus.PROPOSED },
    });
    if (!appt) throw new NotFoundException('Proposal not found or already confirmed.');

    const slots = (appt.proposedSlots as any[]) ?? [];
    const chosen = slots[selectedIndex];
    if (!chosen) throw new BadRequestException('Invalid slot index.');

    const startAt = new Date(chosen.startAt);
    const endAt   = new Date(chosen.endAt);

    await this.assertNoOverlap(db, tenantId, startAt, endAt, appointmentId);

    for (let i = 0; i < slots.length; i++) {
      if (i === selectedIndex) continue;
      const s = slots[i];
      await db.slotHold.deleteMany({
        where: { tenantId, startAt: new Date(s.startAt) },
      });
    }

    const [appointment] = await db.$transaction([
      db.appointment.update({
        where: { id: appointmentId },
        data: {
          status:          AppointmentStatus.CONFIRMED,
          startAt,
          endAt,
          customerTimezone,
          proposedSlots:   Prisma.DbNull,
          bookingToken:    null,
        },
      }),
      db.quoteRequest.update({
        where: { id: appt.quoteRequestId },
        data:  { status: 'SCHEDULED', scheduledAt: startAt },
      }),
      db.auditLog.create({
        data: {
          tenantId,
          actorUserId: appt.userId ?? null,
          action:      AuditAction.APPOINTMENT_CONFIRMED,
          entityType:  'Appointment',
          entityId:    appointmentId,
          metadata:    { startAt } as any,
        },
      }),
    ]);

    await this.sendConfirmation(tenantId, appointment as any);
    return { appointment };
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async cancelByToken(
    cancelToken: string,
    reason: string,
    canceledBy: 'customer' | 'owner',
  ): Promise<void> {
    const found = await this.scanTenants((c) => c.appointment.findUnique({ where: { cancelToken } }));
    if (!found || found.value.status === AppointmentStatus.CANCELED) {
      throw new NotFoundException('Appointment not found or already canceled.');
    }
    const { db, value: appt } = found;
    if (appt.status === AppointmentStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed appointment.');
    }

    await db.$transaction([
      db.appointment.update({
        where: { id: appt.id },
        data: {
          status:        AppointmentStatus.CANCELED,
          canceledAt:    new Date(),
          canceledReason: reason || null,
          canceledBy,
        },
      }),
      db.quoteRequest.update({
        where: { id: appt.quoteRequestId },
        data:  { status: 'ESTIMATE_SENT', scheduledAt: null }, // revert so owner can re-schedule
      }),
      db.auditLog.create({
        data: {
          tenantId:    appt.tenantId,
          actorUserId: appt.userId ?? null,
          action:      AuditAction.APPOINTMENT_CANCELED,
          entityType:  'Appointment',
          entityId:    appt.id,
          metadata:    { canceledBy, reason } as any,
        },
      }),
    ]);
  }

  async cancelById(
    tenantId: string,
    appointmentId: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    const db = await this.db(tenantId);
    const appt = await db.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });
    if (!appt) throw new NotFoundException();
    if (appt.status === AppointmentStatus.CANCELED) throw new BadRequestException('Already canceled.');
    if (appt.status === AppointmentStatus.COMPLETED) throw new BadRequestException('Cannot cancel a completed job.');

    await db.$transaction([
      db.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.CANCELED, canceledAt: new Date(), canceledReason: reason, canceledBy: 'owner' },
      }),
      db.quoteRequest.update({
        where: { id: appt.quoteRequestId },
        data:  { status: 'ESTIMATE_SENT', scheduledAt: null },
      }),
      db.auditLog.create({
        data: { tenantId, actorUserId: actorId, action: AuditAction.APPOINTMENT_CANCELED, entityType: 'Appointment', entityId: appointmentId, metadata: { reason } as any },
      }),
    ]);
  }

  // ── Reschedule ────────────────────────────────────────────────────────────

  async initiateReschedule(rescheduleToken: string): Promise<{
    appointment: any;
    availableSlots: Array<{ startAt: Date; endAt: Date; label: string }>;
  }> {
    const found = await this.scanTenants((c) =>
      c.appointment.findUnique({
        where: { rescheduleToken },
        include: { quoteRequest: { include: { service: { select: { name: true } } } } },
      }),
    );
    if (!found || found.value.status !== AppointmentStatus.CONFIRMED) {
      throw new NotFoundException('Reschedule link not found or appointment is not active.');
    }
    const availableSlots = await this.getAvailableSlots(
      found.tenantId, found.value.durationMinutes, new Date(),
    );
    return { appointment: found.value, availableSlots };
  }

  async completeReschedule(
    originalRescheduleToken: string,
    startAt: Date,
    endAt: Date,
    customerTimezone?: string,
  ): Promise<{ appointment: any }> {
    const found = await this.scanTenants((c) =>
      c.appointment.findUnique({ where: { rescheduleToken: originalRescheduleToken } }),
    );
    if (!found) throw new NotFoundException('Reschedule session expired.');
    const { db, value: original } = found;
    if (original.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException('This appointment can no longer be rescheduled.');
    }

    // Atomic guard: claim the slot. Throws P2002 if someone else holds it.
    let holdId: string;
    try {
      const hold = await db.slotHold.create({
        data: {
          tenantId:  original.tenantId,
          startAt,
          endAt,
          heldUntil: new Date(Date.now() + HOLD_TTL_MINUTES * 60_000),
          holdToken: randomToken(),
        },
      });
      holdId = hold.id;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('That slot was just taken. Please pick another time.');
      }
      throw err;
    }

    try {
      await this.assertNoOverlap(db, original.tenantId, startAt, endAt);
    } catch (e) {
      await db.slotHold.delete({ where: { id: holdId } }).catch(() => {});
      throw e;
    }

    const newRescheduleToken = randomToken();
    const newCancelToken     = randomToken();

    const [newAppt] = await db.$transaction([
      db.appointment.create({
        data: {
          tenantId:          original.tenantId,
          quoteRequestId:    original.quoteRequestId,
          userId:            original.userId,
          mode:              original.mode,
          status:            AppointmentStatus.CONFIRMED,
          startAt,
          endAt,
          durationMinutes:   original.durationMinutes,
          businessTimezone:  original.businessTimezone,
          customerTimezone:  customerTimezone ?? original.customerTimezone,
          rescheduleToken:   newRescheduleToken,
          cancelToken:       newCancelToken,
          rescheduledFromId: original.id,
        },
      }),
      db.appointment.update({
        where: { id: original.id },
        data:  { status: AppointmentStatus.RESCHEDULED, bookingToken: null },
      }),
      db.quoteRequest.update({
        where: { id: original.quoteRequestId },
        data:  { scheduledAt: startAt },
      }),
      db.slotHold.delete({ where: { id: holdId } }),
      db.auditLog.create({
        data: {
          tenantId:    original.tenantId,
          actorUserId: original.userId ?? null,
          action:      AuditAction.APPOINTMENT_RESCHEDULED,
          entityType:  'Appointment',
          entityId:    original.id,
          metadata:    { newStartAt: startAt } as any,
        },
      }),
    ]);

    await this.sendConfirmation(original.tenantId, newAppt as any);
    return { appointment: newAppt };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async listForQuote(tenantId: string, quoteRequestId: string) {
    const db = await this.db(tenantId);
    return db.appointment.findMany({
      where: { tenantId, quoteRequestId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByBookingToken(bookingToken: string) {
    const found = await this.scanTenants((c) =>
      c.appointment.findUnique({
        where: { bookingToken },
        include: { quoteRequest: { include: { service: true } } },
      }),
    );
    if (!found) throw new NotFoundException('Booking link not found or expired.');
    return found.value;
  }

  async adminListUpcoming(tenantId: string, from?: Date, to?: Date) {
    const db = await this.db(tenantId);
    const appts = await db.appointment.findMany({
      where: {
        tenantId,
        status: { notIn: [AppointmentStatus.CANCELED, AppointmentStatus.RESCHEDULED] },
        ...(from || to ? { startAt: { gte: from, lte: to } } : {}),
      },
      include: {
        quoteRequest: { select: { id: true, guestName: true, guestEmail: true, city: true, state: true, addressLine: true } },
      },
      orderBy: { startAt: 'asc' },
    });
    // Attach the owning user's email from the catalog (cross-DB).
    const userIds = Array.from(new Set(appts.map((a) => a.userId).filter((id): id is string => !!id)));
    const users = userIds.length
      ? await this.catalog.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      : [];
    const emailByUser = new Map(users.map((u) => [u.id, u.email]));
    return appts.map((a) => ({ ...a, user: a.userId ? { email: emailByUser.get(a.userId) ?? null } : null }));
  }

  // ── Cron: clean up expired holds ──────────────────────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepExpiredHolds() {
    for (const t of await this.activeTenantIds()) {
      const db = await this.db(t);
      await db.slotHold.deleteMany({ where: { heldUntil: { lt: new Date() } } }).catch(() => {});
    }
  }

  // ── Cron: appointment reminders ───────────────────────────────────────────

  /**
   * 24h + morning-of reminders reduce no-shows. Runs every 15 minutes; the
   * reminder*SentAt columns make each send idempotent across ticks/restarts.
   * Iterates every tenant's database.
   */
  @Cron('0 */15 * * * *') // every 15 minutes
  async sendDueReminders() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 3600_000);
    const in12h = new Date(now.getTime() + 12 * 3600_000);

    for (const t of await this.activeTenantIds()) {
      const db = await this.db(t);

      const due24h = await db.appointment.findMany({
        where: { status: AppointmentStatus.CONFIRMED, reminder24hSentAt: null, startAt: { gt: now, lte: in24h } },
      });
      for (const appt of due24h) {
        await this.sendReminder(db, appt, '24h');
        await db.appointment.update({ where: { id: appt.id }, data: { reminder24hSentAt: new Date() } }).catch(() => {});
      }

      const dueMorning = await db.appointment.findMany({
        where: { status: AppointmentStatus.CONFIRMED, reminderMorningSentAt: null, startAt: { gt: now, lte: in12h } },
      });
      for (const appt of dueMorning) {
        const startLocal = DateTime.fromJSDate(appt.startAt!, { zone: appt.businessTimezone });
        const nowLocal   = DateTime.now().setZone(appt.businessTimezone);
        if (startLocal.hasSame(nowLocal, 'day')) {
          await this.sendReminder(db, appt, 'morning');
          await db.appointment.update({ where: { id: appt.id }, data: { reminderMorningSentAt: new Date() } }).catch(() => {});
        }
      }
    }
  }

  private async activeTenantIds(): Promise<string[]> {
    const tenants = await this.catalog.tenant.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      select: { id: true },
    });
    return tenants.map((t) => t.id);
  }

  private async sendReminder(db: PrismaClient, appt: any, kind: '24h' | 'morning'): Promise<void> {
    try {
      const quote = await db.quoteRequest.findUnique({ where: { id: appt.quoteRequestId } });
      const email = quote?.guestEmail ?? (await this.emailFor(appt.userId));
      if (!email) return;

      const tz    = appt.customerTimezone ?? appt.businessTimezone;
      const start = DateTime.fromJSDate(appt.startAt!, { zone: tz });
      const baseUrl = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
      const lead  = kind === '24h' ? 'tomorrow' : 'today';

      const html = `
<p>Reminder: your appointment is <strong>${lead}</strong>.</p>
<p><strong>${start.toLocaleString(DateTime.DATETIME_HUGE)} ${tz}</strong></p>
<p>Address: ${quote?.addressLine}, ${quote?.city}, ${quote?.state}</p>
<br>
<p>
  <a href="${baseUrl}/book/reschedule/${appt.rescheduleToken}">Reschedule</a> &nbsp;|&nbsp;
  <a href="${baseUrl}/book/cancel/${appt.cancelToken}">Cancel</a>
</p>
      `.trim();

      await this.messaging.sendRawEmail({
        tenantId: appt.tenantId,
        to:       email,
        subject:  kind === '24h' ? 'Reminder: appointment tomorrow' : 'Reminder: appointment today',
        html,
      });
    } catch { /* non-fatal */ }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async assertNoOverlap(
    db: PrismaClient,
    tenantId: string,
    startAt: Date,
    endAt: Date,
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await db.appointment.count({
      where: {
        tenantId,
        id:     excludeId ? { not: excludeId } : undefined,
        status: { notIn: [AppointmentStatus.CANCELED, AppointmentStatus.RESCHEDULED] },
        AND: [{ startAt: { lt: endAt } }, { endAt: { gt: startAt } }],
      },
    });
    if (overlapping > 0) {
      throw new ConflictException('That time slot is no longer available. Please choose another.');
    }
  }

  private async loadSchedulingConfig(db: PrismaClient, tenantId: string): Promise<Scheduling> {
    const cfg = await db.tenantConfig.findUnique({
      where: { tenantId },
      select: { scheduling: true },
    });
    if (!cfg) throw new NotFoundException('Tenant config not found.');
    return cfg.scheduling as unknown as Scheduling;
  }

  /** Send the booking confirmation email. Includes cancel + reschedule links. */
  private async sendConfirmation(tenantId: string, appt: any): Promise<void> {
    try {
      const db = await this.db(tenantId);
      const cfg  = await db.tenantConfig.findUnique({ where: { tenantId } });
      const quote = await db.quoteRequest.findUnique({
        where: { id: appt.quoteRequestId },
        include: { service: true },
      });
      const email = quote?.guestEmail ?? (await this.emailFor(appt.userId));
      if (!email || !cfg) return;

      const tz     = appt.customerTimezone ?? appt.businessTimezone;
      const start  = DateTime.fromJSDate(appt.startAt!, { zone: tz });
      const baseUrl = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
      const contact = (cfg.contact as any);

      const html = `
<p>Your appointment with <strong>${(cfg as any).businessName}</strong> is confirmed.</p>
<p><strong>${start.toLocaleString(DateTime.DATETIME_HUGE)} ${tz}</strong></p>
<p>Address: ${quote?.addressLine}, ${quote?.city}, ${quote?.state}</p>
<br>
<p>
  <a href="${baseUrl}/book/reschedule/${appt.rescheduleToken}">Need to reschedule?</a> &nbsp;|&nbsp;
  <a href="${baseUrl}/book/cancel/${appt.cancelToken}">Cancel appointment</a>
</p>
<p>Questions? Call us at ${contact?.publicPhone ?? ''}.</p>
      `.trim();

      await this.messaging.sendRawEmail({
        tenantId,
        to:      email,
        subject: `Confirmed: ${start.toLocaleString(DateTime.DATE_MED)} appointment`,
        html,
      });

      await db.appointment.update({
        where: { id: appt.id },
        data:  { confirmationSentAt: new Date() },
      });
    } catch { /* non-fatal */ }
  }

  /** Send the proposal email with 2–3 candidate windows the customer can choose from. */
  private async sendProposalEmail(tenantId: string, appt: any): Promise<void> {
    try {
      const db = await this.db(tenantId);
      const cfg   = await db.tenantConfig.findUnique({ where: { tenantId } });
      const quote = await db.quoteRequest.findUnique({ where: { id: appt.quoteRequestId } });
      const email = quote?.guestEmail ?? (await this.emailFor(appt.userId));
      if (!email || !cfg) return;

      const baseUrl = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
      const slots   = (appt.proposedSlots as any[]) ?? [];
      const slotLinks = slots.map((s: any, i: number) =>
        `<li><a href="${baseUrl}/book/confirm-proposed/${appt.id}?slot=${i}">${s.label}</a></li>`,
      ).join('\n');

      const html = `
<p>Your estimate from <strong>${(cfg as any).businessName}</strong> has been accepted, and we have proposed the following appointment windows.</p>
<p>Please click one to confirm your appointment:</p>
<ul>${slotLinks}</ul>
<p>If none of these work, reply to this email and we will find a better time.</p>
      `.trim();

      await this.messaging.sendRawEmail({
        tenantId,
        to:      email,
        subject: `Schedule your appointment — ${(cfg as any).businessName}`,
        html,
      });
    } catch { /* non-fatal */ }
  }
}
