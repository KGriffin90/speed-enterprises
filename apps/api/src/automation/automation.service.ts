import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { MessagingService } from '../messaging/messaging.service';
import { AutomationSchema, type Automation } from '@speed-enterprises/shared';
import { QuoteStatus, AuditAction, AppointmentStatus, type PrismaClient } from '@prisma/client';

/**
 * Scheduled automation engine. Runs:
 *   - estimate-followup  (hourly):  re-engage customers who haven't responded
 *   - review-request     (hourly):  ask for a review after completion delay
 *   - auto-start-jobs    (nightly): SCHEDULED → IN_PROGRESS on the start day
 *   - auto-complete-jobs (nightly): IN_PROGRESS → COMPLETED after the last day
 *
 * Each job iterates active tenants (from the CATALOG registry), opens that
 * tenant's own database via TenantDatabaseService.clientFor(), reads its
 * automation config, and skips disabled work. Customer emails are resolved from
 * the catalog (User). Idempotent — uses EmailLog and quote timestamps to avoid
 * duplicate sends.
 *
 * `process.env.AUTOMATION_ENABLED=false` disables all jobs (useful for tests
 * and one-off dev sessions).
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private catalog: CatalogPrismaService,
    private tenantDb: TenantDatabaseService,
    private messaging: MessagingService,
  ) {}

  private isEnabled(): boolean {
    return process.env.AUTOMATION_ENABLED !== 'false';
  }

  // ── 1. Estimate follow-up ─────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_HOUR, { name: 'estimate-followup' })
  async followUpEstimates() {
    if (!this.isEnabled()) return;
    const tenants = await this.activeTenants();
    let sent = 0;
    for (const t of tenants) {
      const db = await this.tenantDb.clientFor(t.id);
      const cfg = await db.tenantConfig.findUnique({ where: { tenantId: t.id }, select: { automation: true } });
      const auto = this.parseAutomation(cfg?.automation);
      if (!auto.sendFollowUpIfNoResponse) continue;
      const cutoff = new Date(Date.now() - auto.followUpAfterHours * 3600_000);

      const candidates = await db.quoteRequest.findMany({
        where: {
          tenantId: t.id,
          status: QuoteStatus.ESTIMATE_SENT,
          estimateSentAt: { lt: cutoff },
        },
        include: { service: true },
        take: 200,
      });

      for (const q of candidates) {
        const priorFollowUps = await db.emailLog.count({
          where: { tenantId: t.id, quoteRequestId: q.id, kind: 'quote_followup_no_response' },
        });
        if (priorFollowUps >= auto.followUpMaxAttempts) continue;

        const to = q.guestEmail ?? (await this.emailFor(q.userId));
        if (!to) continue;

        await this.messaging.sendForTenant({
          tenantId: t.id,
          kind: 'quote_followup_no_response',
          toEmail: to,
          quoteRequestId: q.id,
          vars: {
            customerFirstName: (q.guestName ?? '').split(' ')[0] ?? '',
            serviceName: q.service.name,
            quoteUrl: `${process.env.WEB_ORIGIN}/dashboard/quotes/${q.id}`,
          },
        });
        sent++;
      }
    }
    if (sent) this.logger.log(`Sent ${sent} estimate follow-up(s)`);
  }

  // ── 2. Review request after completion ────────────────────────────────────
  @Cron(CronExpression.EVERY_HOUR, { name: 'review-request' })
  async sendReviewRequests() {
    if (!this.isEnabled()) return;
    const tenants = await this.activeTenants();
    let sent = 0;
    for (const t of tenants) {
      const db = await this.tenantDb.clientFor(t.id);
      const cfg = await db.tenantConfig.findUnique({ where: { tenantId: t.id }, select: { automation: true, contact: true } });
      const auto = this.parseAutomation(cfg?.automation);
      if (!auto.sendReviewRequestAfterCompletion) continue;
      const cutoff = new Date(Date.now() - auto.reviewRequestDelayHours * 3600_000);

      const candidates = await db.quoteRequest.findMany({
        where: {
          tenantId: t.id,
          status: { in: [QuoteStatus.COMPLETED, QuoteStatus.PAID] },
          completedAt: { lt: cutoff, not: null },
        },
        include: { service: true },
        take: 200,
      });

      for (const q of candidates) {
        const alreadySent = await db.emailLog.count({
          where: { tenantId: t.id, quoteRequestId: q.id, kind: 'review_request_customer' },
        });
        if (alreadySent > 0) continue;

        const to = q.guestEmail ?? (await this.emailFor(q.userId));
        if (!to) continue;

        // Pull reviewUrl from tenant config socialLinks if present
        const contact = (cfg?.contact as any) ?? {};
        const reviewUrl = contact?.socialLinks?.googleBusinessProfile
          ?? contact?.socialLinks?.yelp
          ?? `${process.env.WEB_ORIGIN}/`;

        await this.messaging.sendForTenant({
          tenantId: t.id,
          kind: 'review_request_customer',
          toEmail: to,
          quoteRequestId: q.id,
          vars: {
            customerFirstName: (q.guestName ?? '').split(' ')[0] ?? '',
            serviceName: q.service.name,
            reviewUrl,
          },
        });
        sent++;
      }
    }
    if (sent) this.logger.log(`Sent ${sent} review request(s)`);
  }

  // ── 3. Auto-start scheduled jobs on their start day ───────────────────────
  // SCHEDULED → IN_PROGRESS once the confirmed appointment's start day arrives.
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'auto-start-jobs' })
  async autoStartScheduledJobs() {
    if (!this.isEnabled()) return;
    const tenants = await this.activeTenants();
    const systemActorId = await this.resolveSystemActorId();
    const startOfTomorrow = this.startOfDay(1);
    let started = 0;
    for (const t of tenants) {
      const db = await this.tenantDb.clientFor(t.id);
      const due = await db.appointment.findMany({
        where: {
          tenantId: t.id,
          status: AppointmentStatus.CONFIRMED,
          startAt: { lt: startOfTomorrow, not: null },
          quoteRequest: { status: QuoteStatus.SCHEDULED },
        },
        select: { quoteRequestId: true },
        take: 500,
      });
      for (const a of due) {
        await this.advanceStatus(db, t.id, a.quoteRequestId, QuoteStatus.SCHEDULED, QuoteStatus.IN_PROGRESS, systemActorId, { startedAt: new Date() });
        started++;
      }
    }
    if (started) this.logger.log(`Auto-started ${started} job(s)`);
  }

  // ── 4. Auto-complete jobs after their last day ────────────────────────────
  // IN_PROGRESS → COMPLETED once the confirmed appointment's end day has passed.
  // The appointment endAt already encodes the span (1 day short / 3 days complex).
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'auto-complete-jobs' })
  async autoCompleteJobs() {
    if (!this.isEnabled()) return;
    const tenants = await this.activeTenants();
    const systemActorId = await this.resolveSystemActorId();
    const startOfToday = this.startOfDay(0);
    let completed = 0;
    for (const t of tenants) {
      const db = await this.tenantDb.clientFor(t.id);
      const due = await db.appointment.findMany({
        where: {
          tenantId: t.id,
          status: AppointmentStatus.CONFIRMED,
          endAt: { lt: startOfToday, not: null },
          quoteRequest: { status: QuoteStatus.IN_PROGRESS },
        },
        select: { id: true, quoteRequestId: true },
        take: 500,
      });
      for (const a of due) {
        await this.advanceStatus(db, t.id, a.quoteRequestId, QuoteStatus.IN_PROGRESS, QuoteStatus.COMPLETED, systemActorId, { completedAt: new Date() });
        await db.appointment.update({ where: { id: a.id }, data: { status: AppointmentStatus.COMPLETED } });
        completed++;
      }
    }
    if (completed) this.logger.log(`Auto-completed ${completed} job(s)`);
  }

  /** Midnight (server local time) offset by `daysFromToday` days. */
  private startOfDay(daysFromToday: number): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday);
  }

  /** Apply an automatic status transition: quote update + audit + (best-effort) history. */
  private async advanceStatus(
    db: PrismaClient,
    tenantId: string,
    quoteRequestId: string,
    from: QuoteStatus,
    to: QuoteStatus,
    systemActorId: string | null,
    extra: Record<string, unknown> = {},
  ) {
    await db.$transaction([
      db.quoteRequest.update({ where: { id: quoteRequestId }, data: { status: to, ...extra } }),
      db.auditLog.create({
        data: {
          tenantId, action: AuditAction.QUOTE_STATUS_CHANGED,
          entityType: 'QuoteRequest', entityId: quoteRequestId,
          metadata: { from, to, auto: true } as any,
        },
      }),
      ...(systemActorId
        ? [db.quoteStatusHistory.create({
            data: {
              tenantId, quoteRequestId,
              fromStatus: from, toStatus: to,
              changedById: systemActorId,
              note: 'auto-advanced by automation engine',
            },
          })]
        : []),
    ]);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Active tenants from the catalog registry (no per-tenant config join). */
  private async activeTenants() {
    return this.catalog.tenant.findMany({
      where: {
        status: { in: ['ACTIVE', 'TRIAL'] },
        slug:   { not: '_platform' },
      },
      select: { id: true, slug: true },
    });
  }

  /** Customer email from the catalog, or undefined for guest/no-owner quotes. */
  private async emailFor(userId: string | null): Promise<string | undefined> {
    if (!userId) return undefined;
    const u = await this.catalog.user.findUnique({ where: { id: userId }, select: { email: true } });
    return u?.email;
  }

  private parseAutomation(raw: unknown): Automation {
    const parsed = AutomationSchema.safeParse(raw);
    return parsed.success ? parsed.data : AutomationSchema.parse({});
  }

  // ── Manual run (used by admin "Run now" button if added later) ────────────
  async runAllOnce() {
    await this.followUpEstimates();
    await this.sendReviewRequests();
    await this.autoStartScheduledJobs();
    await this.autoCompleteJobs();
  }

  /**
   * QuoteStatusHistory requires a user FK. For automation-driven transitions
   * we attribute the change to the SYSTEM_USER_ID user (if set), else fall
   * back to any PlatformAdmin user. If neither exists, return null and the
   * history row is skipped (the AuditLog row still records the change).
   */
  private cachedActorId: string | null | undefined;
  private async resolveSystemActorId(): Promise<string | null> {
    if (this.cachedActorId !== undefined) return this.cachedActorId;
    const envId = process.env.SYSTEM_USER_ID;
    if (envId) {
      const u = await this.catalog.user.findUnique({ where: { id: envId } });
      if (u) { this.cachedActorId = u.id; return u.id; }
    }
    const admin = await this.catalog.platformAdmin.findFirst({ select: { userId: true } });
    this.cachedActorId = admin?.userId ?? null;
    return this.cachedActorId;
  }
}
