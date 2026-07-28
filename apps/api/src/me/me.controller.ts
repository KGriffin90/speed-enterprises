import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MeService } from './me.service';
import { AuthGuard, TenantGuard } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { CurrentUser, CurrentUserInfo } from '../common/current-user.decorator';

interface UpdateProfileBody {
  fullName?: string; phone?: string;
  addressLine?: string; city?: string; state?: string; postalCode?: string;
  marketingConsent?: boolean;
}

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

@ApiTags('me')
@Controller('me')
@UseGuards(TenantGuard, AuthGuard)
export class MeController {
  constructor(private me: MeService) {}

  @Get('profile')
  getProfile(@CurrentTenant() tenantId: string, @CurrentUser() me: CurrentUserInfo) {
    return this.me.getProfile(me.id, tenantId);
  }

  @Patch('profile')
  updateProfile(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: UpdateProfileBody,
  ) {
    return this.me.updateProfile(me.id, tenantId, body);
  }

  @Post('change-password')
  changePassword(
    @CurrentUser() me: CurrentUserInfo,
    @Body() body: ChangePasswordBody,
  ) {
    return this.me.changePassword(me.id, body.currentPassword, body.newPassword);
  }

  /**
   * Self-serve account deletion (App Store Guideline 5.1.1(v)).
   * Soft-deletes the user, deactivates memberships, and revokes all refresh
   * tokens so every session dies. Login rejects deletedAt users.
   */
  @Delete('account')
  deleteAccount(@CurrentUser() me: CurrentUserInfo) {
    return this.me.deleteAccount(me.id);
  }
}
