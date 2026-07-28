import { Body, Controller, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthGuard } from '../common/guards';
import { CurrentUser, CurrentUserInfo } from '../common/current-user.decorator';
import {
  RegisterDto, LoginDto, VerifyEmailDto, ForgotPasswordDto, ResetPasswordDto,
  RefreshDto, SwitchTenantDto,
} from '@speed-enterprises/shared';

// Per-route rate limits for the auth surface, tighter than the global
// 120/min/IP. These cap credential brute-force, OTP/token guessing, and
// email-spam/enumeration. Limits are per-IP/minute (see note: trust-proxy
// must be set in prod so the real client IP is used behind a load balancer).
const PER_MINUTE = (limit: number) => ({ default: { limit, ttl: 60_000 } });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Throttle(PER_MINUTE(10)) // account-creation spam
  @Post('register')
  register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.register(RegisterDto.parse(dto), { ipAddress: ip, userAgent });
  }

  @Throttle(PER_MINUTE(10)) // 6-digit OTP brute-force
  @Post('verify-email')
  verify(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(VerifyEmailDto.parse(dto));
  }

  @Throttle(PER_MINUTE(5)) // verification-email spam
  @Post('resend-verification')
  resend(@Body() body: { email: string }) {
    return this.auth.resendVerification(body.email);
  }

  @Throttle(PER_MINUTE(10)) // credential brute-force
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(LoginDto.parse(dto));
  }

  @Throttle(PER_MINUTE(5)) // account enumeration + reset-email spam
  @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(ForgotPasswordDto.parse(dto));
  }

  @Throttle(PER_MINUTE(10)) // reset-token brute-force
  @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(ResetPasswordDto.parse(dto));
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(RefreshDto.parse(dto));
  }

  @Post('logout')
  logout(@Body() body: { refreshToken: string }) {
    return this.auth.logout(body.refreshToken);
  }

  @UseGuards(AuthGuard)
  @Post('switch-tenant')
  switch(@CurrentUser() me: CurrentUserInfo, @Body() dto: SwitchTenantDto) {
    return this.auth.switchTenant(me.id, SwitchTenantDto.parse(dto));
  }
}
