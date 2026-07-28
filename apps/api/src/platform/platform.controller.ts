import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformService } from './platform.service';
import { AuthGuard, RolesGuard, RequirePlatformRole } from '../common/guards';
import { CurrentUser, CurrentUserInfo } from '../common/current-user.decorator';
import { CreateTenantDto, SetTenantStatusDto, InviteMemberDto } from '@speed-enterprises/shared';

@ApiTags('platform')
@Controller('platform')
@UseGuards(AuthGuard, RolesGuard)
@RequirePlatformRole('PLATFORM_ADMIN')
export class PlatformController {
  constructor(private platform: PlatformService) {}

  @Post('tenants')
  createTenant(@CurrentUser() me: CurrentUserInfo, @Body() dto: CreateTenantDto) {
    return this.platform.createTenant(me.id, CreateTenantDto.parse(dto));
  }

  @Get('tenants')
  listTenants() {
    return this.platform.listTenants();
  }

  @Patch('tenants/:id/status')
  setStatus(@CurrentUser() me: CurrentUserInfo, @Param('id') id: string, @Body() dto: SetTenantStatusDto) {
    return this.platform.setStatus(me.id, id, SetTenantStatusDto.parse(dto));
  }

  @Post('tenants/:id/invite')
  invite(@CurrentUser() me: CurrentUserInfo, @Param('id') tenantId: string, @Body() dto: InviteMemberDto) {
    return this.platform.inviteMember(me.id, tenantId, InviteMemberDto.parse(dto));
  }
}
