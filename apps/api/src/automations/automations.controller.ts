import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AutomationsService } from './automations.service';
import { AuthGuard, TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';

interface UpsertBody { subject?: string; body: string; enabled?: boolean }
interface PreviewBody { subject?: string; body?: string }

@ApiTags('automations')
@Controller('me/automations')
@UseGuards(TenantGuard, AuthGuard, RolesGuard)
@RequireTenantRole('OWNER')
export class AutomationsController {
  constructor(private automations: AutomationsService) {}

  @Get()
  list(@CurrentTenant() tenantId: string) {
    return this.automations.list(tenantId);
  }

  @Get(':kind/:channel')
  get(@CurrentTenant() tenantId: string, @Param('kind') kind: string, @Param('channel') channel: string) {
    return this.automations.get(tenantId, kind, channel);
  }

  @Patch(':kind/:channel')
  upsert(
    @CurrentTenant() tenantId: string,
    @Param('kind') kind: string,
    @Param('channel') channel: string,
    @Body() body: UpsertBody,
  ) {
    return this.automations.upsert(tenantId, kind, channel, body);
  }

  @Delete(':kind/:channel')
  reset(@CurrentTenant() tenantId: string, @Param('kind') kind: string, @Param('channel') channel: string) {
    return this.automations.resetToDefault(tenantId, kind, channel);
  }

  @Post(':kind/:channel/preview')
  preview(
    @CurrentTenant() tenantId: string,
    @Param('kind') kind: string,
    @Param('channel') channel: string,
    @Body() body: PreviewBody,
  ) {
    return this.automations.preview(tenantId, kind, channel, body.body, body.subject);
  }
}
