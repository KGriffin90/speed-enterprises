import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TimeService } from './time.service';
import { AuthGuard, TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { CurrentUser, CurrentUserInfo } from '../common/current-user.decorator';

interface ClockInBody  { notesByStaff?: string }
interface ClockOutBody { notesByStaff?: string; breakMinutes?: number }
interface AdminEditBody {
  clockedInAt?: string; clockedOutAt?: string;
  breakMinutes?: number; notesByAdmin?: string;
}

@ApiTags('time')
@UseGuards(TenantGuard, AuthGuard, RolesGuard)
@Controller()
export class TimeController {
  constructor(private time: TimeService) {}

  // ── Staff endpoints (STAFF+) ──────────────────────────────────────────────

  @Post('me/time/clock-in')
  @RequireTenantRole('STAFF')
  clockIn(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: ClockInBody,
  ) {
    return this.time.clockIn(tenantId, me.id, body.notesByStaff);
  }

  @Post('me/time/clock-out')
  @RequireTenantRole('STAFF')
  clockOut(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: ClockOutBody,
  ) {
    return this.time.clockOut(tenantId, me.id, body.notesByStaff, body.breakMinutes ?? 0);
  }

  @Get('me/time/current')
  @RequireTenantRole('STAFF')
  getCurrent(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo) {
    return this.time.getCurrent(tenantId, me.id);
  }

  @Get('me/time')
  @RequireTenantRole('STAFF')
  listMine(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Query('limit') limit?: string,
  ) {
    return this.time.listMine(tenantId, me.id, limit ? parseInt(limit) : 50);
  }

  // The staff member's own pay (hours × their hourly rate) for a period. Scoped
  // to the caller — never exposes anyone else's pay. Defaults to this month.
  @Get('me/pay')
  @RequireTenantRole('STAFF')
  myPay(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.time.myPaySummary(tenantId, me.id, from, to);
  }

  // ── Admin endpoints (OWNER) ──────────────────────────────────────────────

  @Get('admin/time')
  @RequireTenantRole('OWNER')
  listAll(
    @CurrentTenant() tenantId: string,
    @Query('membershipId') membershipId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.time.listAll(tenantId, { membershipId, from, to });
  }

  @Patch('admin/time/:id')
  @RequireTenantRole('OWNER')
  adminEdit(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string,
    @Body() body: AdminEditBody,
  ) {
    return this.time.adminEdit(tenantId, me.id, id, body);
  }

  @Delete('admin/time/:id')
  @RequireTenantRole('OWNER')
  adminDelete(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string,
  ) {
    return this.time.adminDelete(tenantId, me.id, id);
  }

  @Get('admin/payroll')
  @RequireTenantRole('OWNER')
  payroll(
    @CurrentTenant() tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.time.payrollSummary(tenantId, from, to);
  }
}
