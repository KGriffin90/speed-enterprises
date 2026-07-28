import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../database/tenant-db.provider';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { AuditAction, TimeEntryStatus } from '@prisma/client';

/**
 * Time entries + the audit log are TENANT DB rows; memberships (and the users
 * behind them) are CATALOG rows. Reads that previously `include`d a membership
 * now load it from the catalog and stitch it in by membershipId.
 */
@Injectable()
export class TimeService {
  constructor(
    @Inject(TENANT_DB) private prisma: PrismaClient, // tenant DB (timeEntry, auditLog)
    private catalog: CatalogPrismaService,           // control-plane (memberships, users)
  ) {}

  private async resolveMembership(tenantId: string, userId: string): Promise<string> {
    const m = await this.catalog.tenantMembership.findFirst({ where: { userId, tenantId, active: true } });
    if (!m) throw new NotFoundException('Membership not found');
    return m.id;
  }

  /** membershipId → { fullName, role, user: { email } } from the catalog. */
  private async membershipsById(ids: string[]) {
    const rows = await this.catalog.tenantMembership.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, role: true, user: { select: { email: true } } },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  // ── Staff ──────────────────────────────────────────────────────────────────

  async clockIn(tenantId: string, userId: string, notesByStaff?: string) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    const active = await this.prisma.timeEntry.findFirst({
      where: { membershipId, tenantId, status: TimeEntryStatus.ACTIVE },
    });
    if (active) throw new BadRequestException('Already clocked in');

    return this.prisma.timeEntry.create({
      data: { tenantId, membershipId, notesByStaff, status: TimeEntryStatus.ACTIVE },
    });
  }

  async clockOut(tenantId: string, userId: string, notesByStaff?: string, breakMinutes = 0) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    const entry = await this.prisma.timeEntry.findFirst({
      where: { membershipId, tenantId, status: TimeEntryStatus.ACTIVE },
    });
    if (!entry) throw new BadRequestException('Not clocked in');

    return this.prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        clockedOutAt: new Date(),
        breakMinutes,
        status: TimeEntryStatus.COMPLETED,
        ...(notesByStaff !== undefined ? { notesByStaff } : {}),
      },
    });
  }

  async getCurrent(tenantId: string, userId: string) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    return this.prisma.timeEntry.findFirst({
      where: { membershipId, tenantId, status: TimeEntryStatus.ACTIVE },
    });
  }

  async listMine(tenantId: string, userId: string, limit = 50) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    return this.prisma.timeEntry.findMany({
      where: { tenantId, membershipId },
      orderBy: { clockedInAt: 'desc' },
      take: limit,
    });
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async listAll(tenantId: string, opts: { membershipId?: string; from?: string; to?: string } = {}) {
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        tenantId,
        ...(opts.membershipId ? { membershipId: opts.membershipId } : {}),
        ...(opts.from || opts.to ? {
          clockedInAt: {
            ...(opts.from ? { gte: new Date(opts.from) } : {}),
            ...(opts.to   ? { lte: new Date(opts.to)   } : {}),
          },
        } : {}),
      },
      orderBy: { clockedInAt: 'desc' },
    });
    const members = await this.membershipsById(entries.map((e) => e.membershipId));
    return entries.map((e) => ({ ...e, membership: members.get(e.membershipId) ?? null }));
  }

  async adminEdit(
    tenantId: string,
    editorUserId: string,
    entryId: string,
    dto: { clockedInAt?: string; clockedOutAt?: string; breakMinutes?: number; notesByAdmin?: string },
  ) {
    const entry = await this.prisma.timeEntry.findFirst({ where: { id: entryId, tenantId } });
    if (!entry) throw new NotFoundException();

    const updated = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        ...(dto.clockedInAt   ? { clockedInAt:   new Date(dto.clockedInAt)  } : {}),
        ...(dto.clockedOutAt  ? { clockedOutAt:  new Date(dto.clockedOutAt) } : {}),
        ...(dto.breakMinutes  !== undefined ? { breakMinutes: dto.breakMinutes } : {}),
        ...(dto.notesByAdmin  !== undefined ? { notesByAdmin: dto.notesByAdmin } : {}),
        status:        TimeEntryStatus.EDITED,
        adminEditedAt: new Date(),
        adminEditorId: editorUserId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId, actorUserId: editorUserId,
        action: AuditAction.TIME_ENTRY_EDITED,
        entityType: 'TimeEntry', entityId: entryId,
        metadata: dto as any,
      },
    });

    return updated;
  }

  async adminDelete(tenantId: string, editorUserId: string, entryId: string) {
    const entry = await this.prisma.timeEntry.findFirst({ where: { id: entryId, tenantId } });
    if (!entry) throw new NotFoundException();

    await this.prisma.auditLog.create({
      data: {
        tenantId, actorUserId: editorUserId,
        action: AuditAction.TIME_ENTRY_EDITED,
        entityType: 'TimeEntry', entityId: entryId,
        metadata: { deleted: true, entry } as any,
      },
    });

    await this.prisma.timeEntry.delete({ where: { id: entryId } });
    return { ok: true };
  }

  /**
   * A single staff member's own pay for a period (hours × their hourly rate).
   * Scoped to the caller's membership — staff only ever see their own numbers.
   * from/to default to the start of the current month → now.
   */
  async myPaySummary(tenantId: string, userId: string, from?: string, to?: string) {
    const membershipId = await this.resolveMembership(tenantId, userId);
    const toD = to ? new Date(to) : new Date();
    const fromD = from ? new Date(from) : new Date(toD.getFullYear(), toD.getMonth(), 1);

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        tenantId, membershipId,
        clockedInAt: { gte: fromD },
        clockedOutAt: { not: null, lte: toD },
      },
    });
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { membershipId },
      select: { basePayCents: true, payType: true },
    });
    const basePayCents = profile?.basePayCents ?? 0;
    const payType = profile?.payType ?? 'HOURLY';

    let totalMinutes = 0;
    let workedMinutes = 0;
    for (const e of entries) {
      const mins = Math.round((e.clockedOutAt!.getTime() - e.clockedInAt.getTime()) / 60_000);
      totalMinutes += mins;
      workedMinutes += Math.max(0, mins - e.breakMinutes);
    }
    const grossPayCents = payType === 'HOURLY'
      ? Math.round((workedMinutes / 60) * basePayCents)
      : basePayCents; // SALARY: basePayCents is already the period total

    return {
      from: fromD.toISOString(),
      to: toD.toISOString(),
      payType,
      basePayCents,
      totalMinutes,
      workedMinutes,
      entryCount: entries.length,
      grossPayCents,
    };
  }

  async payrollSummary(tenantId: string, from: string, to: string) {
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        tenantId,
        clockedInAt: { gte: new Date(from) },
        clockedOutAt: { not: null, lte: new Date(to) },
      },
    });

    // Memberships + user email from catalog; pay profiles from the tenant DB.
    const membershipIds = Array.from(new Set(entries.map((e) => e.membershipId)));
    const members = await this.membershipsById(membershipIds);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { membershipId: { in: membershipIds } },
      select: { membershipId: true, basePayCents: true, payType: true },
    });
    const profileByMembership = new Map(profiles.map((p) => [p.membershipId, p]));

    const byMember: Record<string, {
      membershipId: string; name: string; email: string; role: string;
      basePayCents: number; payType: string;
      totalMinutes: number; workedMinutes: number; grossPayCents: number; entryCount: number;
    }> = {};

    for (const e of entries) {
      const mid = e.membershipId;
      const m = members.get(mid);
      const prof = profileByMembership.get(mid);
      if (!byMember[mid]) {
        byMember[mid] = {
          membershipId: mid,
          name:  m?.fullName ?? m?.user.email ?? mid,
          email: m?.user.email ?? '',
          role:  m?.role ?? 'STAFF',
          basePayCents: prof?.basePayCents ?? 0,
          payType:      prof?.payType ?? 'HOURLY',
          totalMinutes: 0, workedMinutes: 0, grossPayCents: 0, entryCount: 0,
        };
      }
      const mins = Math.round((e.clockedOutAt!.getTime() - e.clockedInAt.getTime()) / 60_000);
      const worked = Math.max(0, mins - e.breakMinutes);
      byMember[mid].totalMinutes += mins;
      byMember[mid].workedMinutes += worked;
      byMember[mid].entryCount++;
    }

    for (const r of Object.values(byMember)) {
      if (r.payType === 'HOURLY') {
        r.grossPayCents = Math.round((r.workedMinutes / 60) * r.basePayCents);
      }
      // SALARY: basePayCents is already the period total; no calculation needed
    }

    return Object.values(byMember).sort((a, b) => a.name.localeCompare(b.name));
  }
}
