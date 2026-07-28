import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from './config.service';
import { TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { UpdateTenantConfigDto } from '@speed-enterprises/shared';

@ApiTags('config')
@Controller()
export class ConfigController {
  constructor(private configs: ConfigService) {}

  /** Public — lists all active tenants for the mobile business discovery screen. */
  @Get('businesses')
  listBusinesses() {
    return this.configs.listBusinesses();
  }

  /** Public — used by web SSR and mobile boot. Caller passes the slug
   *  (host-based on web, stored slug on mobile). No auth required. */
  @Get('config/:slug')
  getBySlug(@Param('slug') slug: string) {
    return this.configs.getBySlug(slug);
  }

  /** Authenticated tenant admins can fetch their own config via /me/config. */
  @UseGuards(TenantGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  @Get('me/config')
  getMine(@CurrentTenant() tenantId: string) {
    return this.configs.getById(tenantId);
  }

  /** Tenant admins update their own config. */
  @UseGuards(TenantGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  @Patch('me/config')
  updateMine(@CurrentTenant() tenantId: string, @Body() dto: UpdateTenantConfigDto) {
    return this.configs.updateConfig(tenantId, UpdateTenantConfigDto.parse(dto));
  }
}
