import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AutomationService } from './automation.service';
import { AuthGuard, RolesGuard, RequirePlatformRole } from '../common/guards';

/**
 * Manual "run all jobs now" trigger. Restricted to platform admins so it's
 * usable in dev/staging without exposing it to tenant operators.
 */
@ApiTags('automation')
@Controller('platform/automation')
@UseGuards(AuthGuard, RolesGuard)
@RequirePlatformRole('PLATFORM_ADMIN')
export class AutomationController {
  constructor(private automation: AutomationService) {}

  @Post('run-now')
  async runNow() {
    await this.automation.runAllOnce();
    return { ok: true };
  }
}
