import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../database/tenant-db.provider';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TimeService } from '../time/time.service';
import { PAYROLL_PROVIDER, type PayrollProvider } from './payroll-provider';

/**
 * Payroll orchestration.
 *
 * Draft pay runs (hours × rate from the timesheets) work with no provider — the
 * owner can build and review them today. The actual disbursement (approve →
 * direct deposit) is delegated to the embedded-payroll provider and is gated on
 * the provider being configured. We persist only opaque provider ids + amounts;
 * SSN/bank/tax data never touches this service.
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    @Inject(TENANT_DB) private prisma: PrismaClient,
    private catalog: CatalogPrismaService,
    private time: TimeService,
    @Inject(PAYROLL_PROVIDER) private provider: PayrollProvider,
  ) {}

  /** Disbursement features require a configured provider; drafts do not. */
  private assertProvider(): void {
    if (!this.provider.isConfigured()) {
      throw new BadRequestException(
        'Payroll is not connected yet. Add the embedded-payroll (Gusto) API keys to enable paying employees.',
      );
    }
  }

  private async resolveMembership(tenantId: string, userId: string): Promise<string> {
    const m = await this.catalog.tenantMembership.findFirst({ where: { userId, tenantId, active: true } });
    if (!m) throw new NotFoundException('Membership not found');
    return m.id;
  }

  /** Whether payroll is connected, plus the tenant's onboarding state. */
  async status(tenantId: string) {
    const account = await this.prisma.payrollAccount.findUnique({ where: { tenantId } });
    return {
      provider: this.provider.name,
      configured: this.provider.isConfigured(),
      companyOnboarded: !!account?.onboardedAt,
      hasCompanyId: !!account?.providerCompanyId,
    };
  }

  // ── Pay runs ───────────────────────────────────────────────────────────────

  /** Build a DRAFT pay run from timesheet hours for a period. Works offline. */
  async createDraftRun(tenantId: string, ownerUserId: string, from: string, to: string) {
    const createdById = await this.resolveMembership(tenantId, ownerUserId).catch(() => null);
    const rows = await this.time.payrollSummary(tenantId, from, to);
    const totalGrossCents = rows.reduce((s, r) => s + r.grossPayCents, 0);

    return this.prisma.payRun.create({
      data: {
        tenantId,
        status: 'DRAFT',
        periodStart: new Date(from),
        periodEnd: new Date(to),
        totalGrossCents,
        createdById: createdById ?? undefined,
        items: {
          create: rows.map((r) => ({
            tenantId,
            membershipId: r.membershipId,
            workedMinutes: r.workedMinutes,
            grossPayCents: r.grossPayCents,
          })),
        },
      },
      include: { items: true },
    });
  }

  async listRuns(tenantId: string) {
    return this.prisma.payRun.findMany({
      where: { tenantId },
      orderBy: { periodStart: 'desc' },
      include: { _count: { select: { items: true } } },
    });
  }

  async getRun(tenantId: string, id: string) {
    const run = await this.prisma.payRun.findFirst({ where: { id, tenantId }, include: { items: true } });
    if (!run) throw new NotFoundException();
    return run;
  }

  /**
   * Approve a draft run → hand it to the provider for disbursement. Gated on the
   * provider being configured. Idempotent at the provider via the run id.
   */
  async approveRun(tenantId: string, _ownerUserId: string, id: string) {
    this.assertProvider();
    const run = await this.getRun(tenantId, id);
    if (run.status !== 'DRAFT') throw new BadRequestException(`Pay run is already ${run.status}.`);

    const account = await this.prisma.payrollAccount.findUnique({ where: { tenantId } });
    if (!account?.providerCompanyId) {
      throw new BadRequestException('Connect the business to payroll first (company onboarding).');
    }

    // Map each line to its provider employee id (set during employee onboarding).
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { membershipId: { in: run.items.map((i) => i.membershipId) } },
      select: { membershipId: true, payrollEmployeeId: true },
    });
    const providerByMembership = new Map(profiles.map((p) => [p.membershipId, p.payrollEmployeeId]));
    const lines = run.items.map((i) => {
      const providerEmployeeId = providerByMembership.get(i.membershipId);
      if (!providerEmployeeId) {
        throw new BadRequestException('Every employee on the run must finish payroll onboarding first.');
      }
      return { providerEmployeeId, workedMinutes: i.workedMinutes, grossPayCents: i.grossPayCents };
    });

    const { providerPayrollId } = await this.provider.createPayRun({
      providerCompanyId: account.providerCompanyId,
      periodStart: run.periodStart.toISOString(),
      periodEnd: run.periodEnd.toISOString(),
      lines,
      idempotencyKey: run.id, // re-approving can't double-pay
    });
    await this.provider.approvePayRun(providerPayrollId);

    this.logger.log(`Pay run ${run.id} approved → provider payroll ${providerPayrollId}`);
    return this.prisma.payRun.update({
      where: { id: run.id },
      data: { status: 'APPROVED', providerPayrollId, payDate: new Date() },
      include: { items: true },
    });
  }

  // ── Onboarding (provider-gated) ──────────────────────────────────────────────

  /** Connect the business to the payroll provider; returns a hosted onboarding URL. */
  async connectCompany(tenantId: string, legalName: string, returnUrl: string) {
    this.assertProvider();
    let account = await this.prisma.payrollAccount.findUnique({ where: { tenantId } });
    let companyId = account?.providerCompanyId ?? null;
    if (!companyId) {
      const created = await this.provider.createCompany({ tenantId, legalName });
      companyId = created.providerCompanyId;
      account = await this.prisma.payrollAccount.upsert({
        where: { tenantId },
        create: { tenantId, provider: this.provider.name, providerCompanyId: companyId },
        update: { providerCompanyId: companyId },
      });
    }
    const { url } = await this.provider.companyOnboardingUrl(companyId, returnUrl);
    return { url, providerCompanyId: companyId };
  }

  /** Onboard a staff member to payroll; returns the provider-hosted URL where the
   *  employee enters their SSN + bank details (never our app). */
  async employeeOnboardingLink(tenantId: string, membershipId: string, returnUrl: string) {
    this.assertProvider();
    const account = await this.prisma.payrollAccount.findUnique({ where: { tenantId } });
    if (!account?.providerCompanyId) throw new BadRequestException('Connect the business to payroll first.');

    const membership = await this.catalog.tenantMembership.findFirst({
      where: { id: membershipId, tenantId, active: true },
      select: { id: true, fullName: true, userId: true },
    });
    if (!membership) throw new NotFoundException('Staff member not found');
    const user = await this.catalog.user.findUnique({ where: { id: membership.userId }, select: { email: true } });

    let profile = await this.prisma.employeeProfile.findFirst({ where: { membershipId } });
    let providerEmployeeId = profile?.payrollEmployeeId ?? null;
    if (!providerEmployeeId) {
      const created = await this.provider.createEmployee(account.providerCompanyId, {
        membershipId,
        email: user?.email ?? '',
        fullName: membership.fullName,
      });
      providerEmployeeId = created.providerEmployeeId;
      profile = await this.prisma.employeeProfile.upsert({
        where: { membershipId },
        create: { membershipId, payrollEmployeeId: providerEmployeeId },
        update: { payrollEmployeeId: providerEmployeeId },
      });
    }
    const { url } = await this.provider.employeeOnboardingUrl(providerEmployeeId, returnUrl);
    return { url };
  }

  // ── Webhook (provider-gated) ─────────────────────────────────────────────────

  async handleWebhook(rawBody: Buffer | string, signature: string | undefined) {
    const event = this.provider.verifyWebhook(rawBody, signature);
    this.logger.log(`Payroll webhook: ${event.type}`);
    // TODO(gusto): map event.type → PayRun status (PROCESSING/PAID/FAILED) by
    // providerPayrollId once the provider's event shapes are confirmed.
    return { received: true };
  }
}
