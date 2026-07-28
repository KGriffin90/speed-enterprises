import {
  Body, Controller, Delete, Get, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { QuotesService } from '../quotes/quotes.service';
import { AuthGuard, TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentUser, CurrentUserInfo } from '../common/current-user.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { tenantRoleAtLeast } from '@speed-enterprises/shared';

@ApiTags('appointments')
@Controller()
export class AppointmentsController {
  constructor(private appts: AppointmentsService, private quotes: QuotesService) {}

  // ── Available slots (customer or admin previewing) ──────────────────────
  @UseGuards(TenantGuard, AuthGuard)
  @Get('appointments/slots')
  getSlots(
    @CurrentTenant() tenantId: string,
    @Query('durationMinutes') durationMinutes: string,
    @Query('from') from?: string,
  ) {
    const duration = parseInt(durationMinutes ?? '60', 10);
    const fromDate = from ? new Date(from) : new Date();
    return this.appts.getAvailableSlots(tenantId, duration, fromDate);
  }

  // ── Self-serve: place a 10-min hold ────────────────────────────────────
  @UseGuards(TenantGuard, AuthGuard)
  @Post('appointments/holds')
  holdSlot(
    @CurrentTenant() tenantId: string,
    @Body() body: { startAt: string; endAt: string },
  ) {
    return this.appts.holdSlot(tenantId, new Date(body.startAt), new Date(body.endAt));
  }

  // ── Self-serve: confirm booking using holdToken ─────────────────────────
  @UseGuards(TenantGuard, AuthGuard)
  @Post('appointments/confirm-self-serve')
  async confirmSelfServe(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: { holdToken: string; quoteRequestId: string; customerTimezone: string },
  ) {
    // A customer may only book against their own quote; staff+ may book any.
    const isStaffPlus =
      me.platformRole === 'PLATFORM_ADMIN' ||
      (me.tenantRole ? tenantRoleAtLeast(me.tenantRole, 'STAFF') : false);
    if (!isStaffPlus) await this.quotes.assertOwnedByUser(tenantId, me.id, body.quoteRequestId);
    return this.appts.confirmSelfServe(
      tenantId, body.holdToken, body.quoteRequestId, me.id, body.customerTimezone,
    );
  }

  // ── Proposed: owner creates proposal ────────────────────────────────────
  @UseGuards(TenantGuard, AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  @Post('appointments/propose')
  propose(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: { quoteRequestId: string; windows: Array<{ startAt: string; endAt: string }> },
  ) {
    return this.appts.proposeSlots(tenantId, body.quoteRequestId, me.id, body.windows);
  }

  // ── Proposed: customer confirms one slot (authenticated) ────────────────
  @UseGuards(TenantGuard, AuthGuard)
  @Post('appointments/:id/confirm-proposed')
  confirmProposed(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() body: { slotIndex: number; customerTimezone: string },
  ) {
    return this.appts.confirmProposed(id, tenantId, body.slotIndex, body.customerTimezone);
  }

  // ── Admin: cancel by appointment id ─────────────────────────────────────
  @UseGuards(TenantGuard, AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  @Delete('appointments/:id')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.appts.cancelById(tenantId, id, me.id, body.reason ?? '');
  }

  // ── Admin: list upcoming appointments ───────────────────────────────────
  @UseGuards(TenantGuard, AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  @Get('appointments')
  listUpcoming(
    @CurrentTenant() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.appts.adminListUpcoming(
      tenantId,
      from ? new Date(from) : undefined,
      to   ? new Date(to)   : undefined,
    );
  }

  // ── List appointments for a quote ────────────────────────────────────────
  @UseGuards(TenantGuard, AuthGuard)
  @Get('quotes/:quoteId/appointments')
  async listForQuote(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Param('quoteId') quoteId: string,
  ) {
    // Object-level authorization: staff+ (and platform admins) may read any
    // quote's appointments; a customer may only read their own quote's.
    const isStaffPlus =
      me.platformRole === 'PLATFORM_ADMIN' ||
      (me.tenantRole ? tenantRoleAtLeast(me.tenantRole, 'STAFF') : false);
    if (!isStaffPlus) await this.quotes.assertOwnedByUser(tenantId, me.id, quoteId);
    return this.appts.listForQuote(tenantId, quoteId);
  }

  // ── Public token routes (no guards — opened from email links in a fresh ──
  //    browser with no tenant cookie; the token itself scopes the tenant). ──

  /** Reschedule: returns available slots and a new booking token. */
  @Get('book/reschedule/:token')
  getReschedulePage(@Param('token') token: string) {
    return this.appts.initiateReschedule(token);
  }

  /** Reschedule: confirm the newly chosen window. */
  @Post('book/reschedule/:token')
  completeReschedule(
    @Param('token') token: string,
    @Body() body: { startAt: string; endAt: string; customerTimezone?: string },
  ) {
    return this.appts.completeReschedule(
      token, new Date(body.startAt), new Date(body.endAt), body.customerTimezone,
    );
  }

  /** Cancel via email link. */
  @Post('book/cancel/:token')
  cancelByToken(
    @Param('token') token: string,
    @Body() body: { reason?: string },
  ) {
    return this.appts.cancelByToken(token, body.reason ?? '', 'customer');
  }

  /** Proposed: confirm from email link (unauthenticated one-click). */
  @Post('book/confirm-proposed/:appointmentId')
  confirmProposedPublic(
    @Param('appointmentId') appointmentId: string,
    @Query('slot') slotIndex: string,
    @Body() body: { customerTimezone?: string },
  ) {
    const tz = body.customerTimezone ?? 'America/Denver';
    // tenantId derived from the appointment row inside the service.
    return this.appts.confirmProposed(appointmentId, null, parseInt(slotIndex ?? '0', 10), tz);
  }

  /** Booking page: load appointment details by bookingToken. */
  @Get('book/:token')
  getBooking(@Param('token') token: string) {
    return this.appts.getByBookingToken(token);
  }
}
