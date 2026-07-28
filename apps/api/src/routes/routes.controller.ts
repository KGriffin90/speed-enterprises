import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RouteRecurrence } from '@prisma/client';
import { RoutesService } from './routes.service';
import { AuthGuard, TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { CurrentUser, CurrentUserInfo } from '../common/current-user.decorator';

interface WaypointBody {
  lat: number; lng: number;
  accuracy?: number; speed?: number; heading?: number; altitude?: number;
  recordedAt: string;
}

@ApiTags('routes')
@UseGuards(TenantGuard, AuthGuard, RolesGuard)
@Controller()
export class RoutesController {
  constructor(private routes: RoutesService) {}

  // ── Staff endpoints (STAFF+) ──────────────────────────────────────────────

  @Post('me/routes')
  @RequireTenantRole('STAFF')
  startRoute(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: { timeEntryId?: string },
  ) {
    return this.routes.startRoute(tenantId, me.id, body.timeEntryId);
  }

  @Post('me/routes/:id/waypoints')
  @RequireTenantRole('STAFF')
  addWaypoint(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string,
    @Body() body: WaypointBody,
  ) {
    return this.routes.addWaypoint(tenantId, me.id, id, body);
  }

  @Post('me/routes/:id/end')
  @RequireTenantRole('STAFF')
  endRoute(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string,
    @Body() body: { distanceMiles?: number },
  ) {
    return this.routes.endRoute(tenantId, me.id, id, { distanceMiles: body?.distanceMiles });
  }

  // Planned-route stop check-ins (the per-stop timing the owner sees).
  @Post('me/routes/:id/start')
  @RequireTenantRole('STAFF')
  startPlanned(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string) {
    return this.routes.startPlannedRoute(tenantId, me.id, id);
  }

  @Post('me/routes/:id/stops/:stopId/arrive')
  @RequireTenantRole('STAFF')
  arriveStop(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string, @Param('stopId') stopId: string) {
    return this.routes.arriveStop(tenantId, me.id, id, stopId);
  }

  @Post('me/routes/:id/stops/:stopId/depart')
  @RequireTenantRole('STAFF')
  departStop(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string, @Param('stopId') stopId: string) {
    return this.routes.departStop(tenantId, me.id, id, stopId);
  }

  // NOTE: declared before `me/routes/:id` so "assigned" isn't captured as an :id.
  @Get('me/routes/assigned')
  @RequireTenantRole('STAFF')
  listAssigned(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo) {
    return this.routes.listAssigned(tenantId, me.id);
  }

  @Get('me/routes')
  @RequireTenantRole('STAFF')
  listMine(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Query('limit') limit?: string,
  ) {
    return this.routes.listMine(tenantId, me.id, limit ? parseInt(limit) : 30);
  }

  @Get('me/routes/:id')
  @RequireTenantRole('STAFF')
  getRoute(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string,
  ) {
    return this.routes.getRoute(tenantId, me.id, id);
  }

  // ── Admin endpoints (OWNER) ──────────────────────────────────────────────

  @Get('admin/routes')
  @RequireTenantRole('OWNER')
  listAll(
    @CurrentTenant() tenantId: string,
    @Query('membershipId') membershipId?: string,
    @Query('phase') phase?: string, // all | planned | running | completed
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.routes.listAll(tenantId, { membershipId, phase, from, to });
  }

  // Owner builds a route and assigns it to a staff member.
  @Post('admin/routes')
  @RequireTenantRole('OWNER')
  createPlanned(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: {
      name?: string;
      membershipId?: string;
      membershipIds?: string[];
      plannedForDate?: string;
      stops: Array<{ label: string; addressLine?: string; city?: string; state?: string; postalCode?: string; lat?: number; lng?: number; quoteRequestId?: string }>;
    },
  ) {
    return this.routes.createPlannedRoute(tenantId, me.id, body);
  }

  // Owner edits a planned route (name/date always; crew + stops while PLANNED).
  @Patch('admin/routes/:id')
  @RequireTenantRole('OWNER')
  editPlanned(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      membershipIds?: string[];
      plannedForDate?: string;
      stops?: Array<{ label: string; addressLine?: string; city?: string; state?: string; postalCode?: string; lat?: number; lng?: number; quoteRequestId?: string }>;
    },
  ) {
    return this.routes.updatePlannedRoute(tenantId, id, body);
  }

  @Delete('admin/routes/:id')
  @RequireTenantRole('OWNER')
  deletePlanned(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.routes.deletePlannedRoute(tenantId, id);
  }

  @Get('admin/routes/:id')
  @RequireTenantRole('OWNER')
  adminGetRoute(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.routes.adminGetRoute(tenantId, id);
  }

  // ── Route templates (OWNER) ──────────────────────────────────────────────

  @Get('admin/route-templates')
  @RequireTenantRole('OWNER')
  listTemplates(@CurrentTenant() tenantId: string) {
    return this.routes.listTemplates(tenantId);
  }

  @Post('admin/route-templates')
  @RequireTenantRole('OWNER')
  createTemplate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: { name?: string; recurrence?: RouteRecurrence; startDate?: string; membershipIds?: string[]; stops?: Array<{ label: string; addressLine?: string; city?: string; state?: string; postalCode?: string; lat?: number; lng?: number; quoteRequestId?: string }> },
  ) {
    return this.routes.createTemplate(tenantId, me.id, body);
  }

  // Save an existing route's stop list as a reusable template.
  @Post('admin/route-templates/from-route/:routeId')
  @RequireTenantRole('OWNER')
  saveRouteAsTemplate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Param('routeId') routeId: string,
    @Body() body: { name?: string },
  ) {
    return this.routes.saveRouteAsTemplate(tenantId, me.id, routeId, body?.name);
  }

  @Get('admin/route-templates/:id')
  @RequireTenantRole('OWNER')
  getTemplate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.routes.getTemplate(tenantId, id);
  }

  @Patch('admin/route-templates/:id')
  @RequireTenantRole('OWNER')
  updateTemplate(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; recurrence?: RouteRecurrence; startDate?: string | null; membershipIds?: string[]; stops?: Array<{ label: string; addressLine?: string; city?: string; state?: string; postalCode?: string; lat?: number; lng?: number; quoteRequestId?: string }> },
  ) {
    return this.routes.updateTemplate(tenantId, id, body);
  }

  @Delete('admin/route-templates/:id')
  @RequireTenantRole('OWNER')
  deleteTemplate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.routes.deleteTemplate(tenantId, id);
  }

  // Clone a template into a working PLANNED route (assign staff + date).
  @Post('admin/routes/from-template')
  @RequireTenantRole('OWNER')
  createRouteFromTemplate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: { templateId: string; membershipId?: string; membershipIds?: string[]; plannedForDate?: string; name?: string },
  ) {
    return this.routes.createRouteFromTemplate(tenantId, me.id, body);
  }
}
