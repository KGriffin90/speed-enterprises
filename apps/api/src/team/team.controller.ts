import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TeamService } from './team.service';
import { AuthGuard, TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { CurrentUser, CurrentUserInfo } from '../common/current-user.decorator';
import { TenantRole } from '@prisma/client';

interface InviteBody { email: string; fullName: string; role: TenantRole; phone?: string }
interface RoleBody   { role: TenantRole }
interface PayBody    { basePayCents: number; payType?: string; avgMpg?: number; vehicleNotes?: string; phone?: string }

@ApiTags('team')
@Controller('me/team')
@UseGuards(TenantGuard, AuthGuard, RolesGuard)
@RequireTenantRole('OWNER')
export class TeamController {
  constructor(private team: TeamService) {}

  @Get()
  list(@CurrentTenant() tenantId: string) {
    return this.team.list(tenantId);
  }

  @Post('invite')
  invite(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Body() body: InviteBody) {
    return this.team.invite(tenantId, me.id, (me.tenantRole ?? 'CUSTOMER') as TenantRole, body);
  }

  @Patch(':id/role')
  changeRole(
    @CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo,
    @Param('id') id: string, @Body() body: RoleBody,
  ) {
    return this.team.changeRole(tenantId, me.id, (me.tenantRole ?? 'CUSTOMER') as TenantRole, id, body.role);
  }

  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string) {
    return this.team.remove(tenantId, me.id, (me.tenantRole ?? 'CUSTOMER') as TenantRole, id);
  }

  // Permanent (hard) delete — removes the member + their data from the DB.
  @Delete(':id/permanent')
  hardDelete(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string) {
    return this.team.hardDelete(tenantId, me.id, id);
  }

  @Patch(':id/pay')
  setPay(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo, @Param('id') id: string, @Body() body: PayBody) {
    return this.team.setPay(tenantId, me.id, id, body);
  }
}
