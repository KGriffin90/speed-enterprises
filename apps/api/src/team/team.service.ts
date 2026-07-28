import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../database/tenant-db.provider';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { TenantRole, TokenPurpose, AuditAction } from '@prisma/client';

/**
 * Team management is mostly CATALOG work: memberships, users, invite tokens, and
 * the tenant registry all live there. Only the audit log and employee pay
 * profiles are TENANT DB rows, stitched in by membershipId where needed.
 */
@Injectable()
export class TeamService {
  constructor(
    @Inject(TENANT_DB) private prisma: PrismaClient, // tenant DB (auditLog, employeeProfile)
    private catalog: CatalogPrismaService,           // control-plane (memberships, users, tokens)
    private messaging: MessagingService,
  ) {}

  async list(tenantId: string) {
    const members = await this.catalog.tenantMembership.findMany({
      where: { tenantId },
      include: {
        user: { select: { email: true, emailVerifiedAt: true, lastLoginAt: true } },
      },
      orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
    });
    // Employee pay profiles live in the tenant DB — attach by membershipId.
    // (Whole rows, no select: also returns `phone` once the column migration
    // has run, without a hard type dependency on the regenerated client.)
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { membershipId: { in: members.map((m) => m.id) } },
    });
    const byMembership = new Map(profiles.map((p) => [p.membershipId, p]));
    return members.map((m) => ({ ...m, employeeProfile: byMembership.get(m.id) ?? null }));
  }

  async invite(
    tenantId: string,
    actorUserId: string,
    _actorRole: TenantRole,
    dto: { email: string; fullName: string; role: TenantRole; phone?: string },
  ) {
    // Any OWNER can invite at any level
    await this.catalog.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const email = dto.email.toLowerCase();
    const existing = await this.catalog.user.findUnique({ where: { email } });

    if (existing) {
      const m = await this.catalog.tenantMembership.upsert({
        where:  { userId_tenantId: { userId: existing.id, tenantId } },
        create: { userId: existing.id, tenantId, role: dto.role, fullName: dto.fullName, invitedById: actorUserId, acceptedAt: new Date() },
        update: { role: dto.role, active: true, fullName: dto.fullName },
      });
      await this.upsertPhone(m.id, dto.phone);
      await this.prisma.auditLog.create({
        data: { tenantId, actorUserId, action: AuditAction.MEMBER_INVITED, entityType: 'User', entityId: existing.id, metadata: { role: dto.role, immediate: true } },
      });
      return { invited: true, immediate: true, membershipId: m.id, setupEmailSent: false };
    }

    // New person: create the account and membership NOW, then email a
    // set-your-password link through the existing PASSWORD_RESET flow.
    // (The previous TENANT_INVITE token had no consumer anywhere — the sign-up
    // page ignored the ?invite= param — so emailed invites were a dead end.)
    // emailVerifiedAt is set because the ONLY way this account gains a
    // password is by proving control of the inbox via the emailed link.
    const user = await this.catalog.user.create({
      data: { email, platformRole: 'CUSTOMER', emailVerifiedAt: new Date() },
    });
    const m = await this.catalog.tenantMembership.create({
      data: { userId: user.id, tenantId, role: dto.role, fullName: dto.fullName, invitedById: actorUserId, acceptedAt: new Date() },
    });
    await this.upsertPhone(m.id, dto.phone);

    const secret = crypto.randomBytes(32).toString('hex');
    await this.catalog.verificationToken.create({
      data: {
        userId:    user.id,
        purpose:   TokenPurpose.PASSWORD_RESET,
        tokenHash: sha256(secret),
        expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000), // generous onboarding window
      },
    });
    await this.messaging.sendPasswordReset(email, secret);

    await this.prisma.auditLog.create({
      data: { tenantId, actorUserId, action: AuditAction.MEMBER_INVITED, entityType: 'User', entityId: user.id, metadata: { role: dto.role, immediate: true, created: true } },
    });
    return { invited: true, immediate: true, membershipId: m.id, setupEmailSent: true };
  }

  /** Store the staff work phone on the (tenant-DB) employee profile. */
  private async upsertPhone(membershipId: string, phone?: string) {
    if (!phone?.trim()) return;
    // NOTE: `as any` until `prisma generate` runs after the
    // 20260612090000_employee_profile_phone migration adds the column.
    await this.prisma.employeeProfile.upsert({
      where:  { membershipId },
      create: { membershipId, phone: phone.trim() } as any,
      update: { phone: phone.trim() } as any,
    });
  }

  async changeRole(tenantId: string, actorUserId: string, _actorRole: TenantRole, membershipId: string, newRole: TenantRole) {
    const m = await this.catalog.tenantMembership.findFirst({ where: { id: membershipId, tenantId } });
    if (!m) throw new NotFoundException();
    if (m.userId === actorUserId) throw new BadRequestException("Don't change your own role");
    const updated = await this.catalog.tenantMembership.update({ where: { id: membershipId }, data: { role: newRole } });
    await this.prisma.auditLog.create({
      data: { tenantId, actorUserId, action: AuditAction.MEMBER_ROLE_CHANGED, entityType: 'TenantMembership', entityId: m.id, metadata: { from: m.role, to: newRole } as any },
    });
    return updated;
  }

  async remove(tenantId: string, actorUserId: string, _actorRole: TenantRole, membershipId: string) {
    const m = await this.catalog.tenantMembership.findFirst({ where: { id: membershipId, tenantId } });
    if (!m) throw new NotFoundException();
    if (m.userId === actorUserId) throw new BadRequestException("Don't remove yourself");
    await this.catalog.tenantMembership.update({ where: { id: m.id }, data: { active: false } });
    await this.prisma.auditLog.create({
      data: { tenantId, actorUserId, action: AuditAction.MEMBER_REMOVED, entityType: 'TenantMembership', entityId: m.id, metadata: { role: m.role } as any },
    });
  }

  /**
   * Permanently delete a team member — removes the membership AND their
   * tenant-DB data (pay profile, time entries, routes). Used on already-removed
   * members to clear them out for good. The User identity row is left intact
   * (it may be a customer elsewhere / referenced by quotes); a re-invite of the
   * same email simply re-creates the membership.
   */
  async hardDelete(tenantId: string, actorUserId: string, membershipId: string) {
    const m = await this.catalog.tenantMembership.findFirst({ where: { id: membershipId, tenantId } });
    if (!m) throw new NotFoundException();
    if (m.userId === actorUserId) throw new BadRequestException("Don't delete yourself");

    // Membership lives in the catalog DB; pay/time/route rows live in the tenant
    // DB and are joined by membershipId (no cross-DB FK in prod) — clear them
    // explicitly so nothing is orphaned, then drop the membership.
    await this.prisma.routeAssignee.deleteMany({ where: { membershipId: m.id } });
    await this.prisma.workRoute.deleteMany({ where: { membershipId: m.id } }); // cascades stops/waypoints
    await this.prisma.timeEntry.deleteMany({ where: { membershipId: m.id } });
    await this.prisma.employeeProfile.deleteMany({ where: { membershipId: m.id } });
    await this.prisma.auditLog.create({
      data: { tenantId, actorUserId, action: AuditAction.MEMBER_REMOVED, entityType: 'TenantMembership', entityId: m.id, metadata: { role: m.role, permanent: true } as any },
    });
    await this.catalog.tenantMembership.delete({ where: { id: m.id } });
    return { deleted: true };
  }

  async setPay(
    tenantId: string,
    actorUserId: string,
    membershipId: string,
    dto: { basePayCents: number; payType?: string; avgMpg?: number; vehicleNotes?: string; phone?: string },
  ) {
    const m = await this.catalog.tenantMembership.findFirst({ where: { id: membershipId, tenantId } });
    if (!m) throw new NotFoundException();

    // `phone` is `as any` until the regenerated client picks up the
    // employee_profile_phone migration column (mirrors upsertPhone above).
    const phone = dto.phone !== undefined ? (dto.phone.trim() || null) : undefined;
    const profile = await this.prisma.employeeProfile.upsert({
      where:  { membershipId },
      create: { membershipId, basePayCents: dto.basePayCents, payType: (dto.payType ?? 'HOURLY') as any, avgMpg: dto.avgMpg ?? 25, vehicleNotes: dto.vehicleNotes, ...(phone !== undefined ? { phone } : {}) } as any,
      update: {
        basePayCents: dto.basePayCents,
        ...(dto.payType      !== undefined ? { payType:      dto.payType as any } : {}),
        ...(dto.avgMpg       !== undefined ? { avgMpg:       dto.avgMpg }         : {}),
        ...(dto.vehicleNotes !== undefined ? { vehicleNotes: dto.vehicleNotes }    : {}),
        ...(phone            !== undefined ? { phone }                              : {}),
      } as any,
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId, actorUserId,
        action: AuditAction.PAY_RATE_UPDATED,
        entityType: 'TenantMembership', entityId: membershipId,
        metadata: { basePayCents: dto.basePayCents, payType: dto.payType } as any,
      },
    });

    return profile;
  }
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
