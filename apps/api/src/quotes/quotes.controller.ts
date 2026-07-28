import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { QuotesService } from './quotes.service';
import { AuthGuard, TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentUser, CurrentUserInfo } from '../common/current-user.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import {
  CreateQuoteDto, UpdateQuoteDto, ChangeStatusDto, SendEstimateDto,
  PublicQuoteRequestDto, AddLineItemDto, UpdateLineItemDto,
} from '@speed-enterprises/shared';
import { z } from 'zod';

/** Admin-editable quote fields: staff-only internal notes, plus the owner's job
 *  complexity classification and the customer-facing complexity note. */
const AdminUpdateQuoteDto = z.object({
  internalNotes:  z.string().max(10_000).nullable().optional(),
  jobComplexity:  z.enum(['SIMPLE', 'COMPLEX']).nullable().optional(),
  complexityNote: z.string().max(5_000).nullable().optional(),
});

@ApiTags('quotes')
@Controller()
@UseGuards(TenantGuard)
export class QuotesController {
  constructor(private quotes: QuotesService) {}

  // ── Customer endpoints ───────────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Get('quotes/mine')
  listMine(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo) {
    return this.quotes.listMine(tenantId, me.id);
  }

  @UseGuards(AuthGuard)
  @Post('quotes')
  create(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Body() dto: CreateQuoteDto) {
    return this.quotes.createForUser(tenantId, me.id, CreateQuoteDto.parse(dto));
  }

  @UseGuards(AuthGuard)
  @Get('quotes/:id')
  getMine(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string) {
    // Object-level authorization: a customer may only read their own quote.
    // Admin/staff use the unrestricted GET /admin/quotes/:id below.
    return this.quotes.getByIdForUser(tenantId, me.id, id);
  }

  @UseGuards(AuthGuard)
  @Patch('quotes/:id')
  updateMine(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string, @Body() dto: UpdateQuoteDto) {
    return this.quotes.update(tenantId, me.id, id, UpdateQuoteDto.parse(dto));
  }

  @UseGuards(AuthGuard)
  @Post('quotes/:id/submit')
  submit(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string) {
    return this.quotes.submit(tenantId, me.id, id);
  }

  @UseGuards(AuthGuard)
  @Post('quotes/:id/accept')
  accept(
    @CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string, @Body() body: { note?: string },
  ) {
    return this.quotes.acceptEstimate(tenantId, me.id, id, body?.note);
  }

  @UseGuards(AuthGuard)
  @Post('quotes/:id/decline')
  decline(
    @CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string, @Body() body: { reason: string },
  ) {
    return this.quotes.declineEstimate(tenantId, me.id, id, body?.reason ?? '');
  }

  @UseGuards(AuthGuard)
  @Delete('quotes/:id')
  remove(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string) {
    return this.quotes.remove(tenantId, me.id, id);
  }

  // ── Line items (customer or admin) ───────────────────────────────────────
  @UseGuards(AuthGuard)
  @Post('quotes/:id/items')
  addItem(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string, @Body() dto: AddLineItemDto) {
    return this.quotes.addLineItem(tenantId, me.id, id, AddLineItemDto.parse(dto));
  }

  @UseGuards(AuthGuard)
  @Patch('quotes/:id/items/:itemId')
  updateItem(
    @CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: UpdateLineItemDto,
  ) {
    return this.quotes.updateLineItem(tenantId, me.id, id, itemId, UpdateLineItemDto.parse(dto));
  }

  @UseGuards(AuthGuard)
  @Delete('quotes/:id/items/:itemId')
  removeItem(
    @CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string, @Param('itemId') itemId: string,
  ) {
    return this.quotes.removeLineItem(tenantId, me.id, id, itemId);
  }

  // ── Public (anonymous) quote submission ──────────────────────────────────
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('public/quotes')
  createPublic(@CurrentTenant() tenantId: string, @Body() dto: PublicQuoteRequestDto) {
    return this.quotes.createPublic(tenantId, PublicQuoteRequestDto.parse(dto));
  }

  // ── Admin endpoints ──────────────────────────────────────────────────────
  @UseGuards(AuthGuard, RolesGuard)
  @RequireTenantRole('STAFF')
  @Get('admin/quotes')
  adminList(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
    @Query('serviceId') serviceId?: string,
    @Query('q') q?: string,
  ) {
    return this.quotes.listAdmin(tenantId, { status, serviceId, q });
  }

  @UseGuards(AuthGuard, RolesGuard)
  @RequireTenantRole('STAFF')
  @Get('admin/quotes/:id')
  async adminGet(
    @CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string,
  ) {
    // Opening a NEW quote auto-advances it to REVIEWING.
    await this.quotes.markReviewing(tenantId, me.id, id);
    return this.quotes.getById(tenantId, id);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  @Patch('admin/quotes/:id/status')
  adminChangeStatus(
    @CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string, @Body() dto: ChangeStatusDto,
  ) {
    return this.quotes.changeStatus(tenantId, me.id, id, ChangeStatusDto.parse(dto));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  @Post('admin/quotes/:id/estimate')
  adminSendEstimate(
    @CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string, @Body() dto: SendEstimateDto,
  ) {
    return this.quotes.sendEstimate(tenantId, me.id, id, SendEstimateDto.parse(dto));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  @Patch('admin/quotes/:id')
  adminUpdate(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: unknown,
  ) {
    return this.quotes.adminUpdate(tenantId, id, AdminUpdateQuoteDto.parse(dto));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  @Delete('admin/quotes/:id')
  adminRemove(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string) {
    return this.quotes.adminRemove(tenantId, me.id, id);
  }
}
