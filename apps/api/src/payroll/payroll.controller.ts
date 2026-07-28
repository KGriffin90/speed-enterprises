import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { AuthGuard, TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { CurrentUser, CurrentUserInfo } from '../common/current-user.decorator';

/**
 * Owner-only payroll endpoints. Draft pay runs work today; connect/onboarding/
 * approve are gated on the embedded-payroll provider (Gusto) being configured.
 *
 * NOTE: the provider status webhook is intentionally not exposed here. It must
 * resolve the tenant from the event's company id (not request scope, since this
 * service is request-scoped on the tenant DB) — wire it in a dedicated, tenant-
 * less controller when finishing the Gusto integration.
 */
@ApiTags('payroll')
@UseGuards(TenantGuard, AuthGuard, RolesGuard)
@Controller('admin/payroll')
export class PayrollController {
  constructor(private payroll: PayrollService) {}

  @Get('status')
  @RequireTenantRole('OWNER')
  status(@CurrentTenant() tenantId: string) {
    return this.payroll.status(tenantId);
  }

  // Connect the business to payroll → returns a provider-hosted onboarding URL.
  @Post('connect')
  @RequireTenantRole('OWNER')
  connect(@CurrentTenant() tenantId: string, @Body() body: { legalName: string; returnUrl: string }) {
    return this.payroll.connectCompany(tenantId, body.legalName, body.returnUrl);
  }

  // Onboard a staff member → returns the provider URL where THEY enter SSN/bank.
  @Post('employees/:membershipId/onboarding')
  @RequireTenantRole('OWNER')
  employeeOnboarding(
    @CurrentTenant() tenantId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { returnUrl: string },
  ) {
    return this.payroll.employeeOnboardingLink(tenantId, membershipId, body.returnUrl);
  }

  @Get('runs')
  @RequireTenantRole('OWNER')
  listRuns(@CurrentTenant() tenantId: string) {
    return this.payroll.listRuns(tenantId);
  }

  // Build a DRAFT pay run from the period's timesheet hours (works without Gusto).
  @Post('runs')
  @RequireTenantRole('OWNER')
  createRun(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: { from: string; to: string },
  ) {
    return this.payroll.createDraftRun(tenantId, me.id, body.from, body.to);
  }

  @Get('runs/:id')
  @RequireTenantRole('OWNER')
  getRun(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.payroll.getRun(tenantId, id);
  }

  // Approve a draft → hand to the provider for direct deposit (gated on Gusto).
  @Post('runs/:id/approve')
  @RequireTenantRole('OWNER')
  approveRun(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string,
  ) {
    return this.payroll.approveRun(tenantId, me.id, id);
  }
}
