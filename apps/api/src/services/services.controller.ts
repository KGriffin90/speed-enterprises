import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ServicesService } from './services.service';
import { TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { CreateServiceDto, UpdateServiceDto } from '@speed-enterprises/shared';

@ApiTags('services')
@Controller('services')
@UseGuards(TenantGuard)
export class ServicesController {
  constructor(private services: ServicesService) {}

  /** Public services for the resolved tenant — used by the public quote form. */
  @Get('public')
  listPublic(@CurrentTenant() tenantId: string) {
    return this.services.listPublic(tenantId);
  }

  @UseGuards(RolesGuard)
  @RequireTenantRole('STAFF')
  @Get()
  list(@CurrentTenant() tenantId: string) {
    return this.services.list(tenantId);
  }

  @UseGuards(RolesGuard)
  @RequireTenantRole('STAFF')
  @Get(':id')
  get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.services.getById(tenantId, id);
  }

  @UseGuards(RolesGuard)
  @RequireTenantRole('OWNER')
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateServiceDto) {
    return this.services.create(tenantId, CreateServiceDto.parse(dto));
  }

  @UseGuards(RolesGuard)
  @RequireTenantRole('OWNER')
  @Patch(':id')
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.services.update(tenantId, id, UpdateServiceDto.parse(dto));
  }

  @UseGuards(RolesGuard)
  @RequireTenantRole('OWNER')
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.services.remove(tenantId, id);
  }
}
