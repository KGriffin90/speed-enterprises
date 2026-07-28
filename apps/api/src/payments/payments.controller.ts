import { Body, Controller, Get, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { AuthGuard, TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post('connect/start')
  @UseGuards(TenantGuard, AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  startOnboarding(
    @CurrentTenant() tenantId: string,
    @Body() body: { returnUrl: string; refreshUrl: string },
  ) {
    return this.payments.startOnboarding(tenantId, body.returnUrl, body.refreshUrl);
  }

  @Get('connect/status')
  @UseGuards(TenantGuard, AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  getStatus(@CurrentTenant() tenantId: string) {
    return this.payments.getAccountStatus(tenantId);
  }

  @Post('webhook')
  handleWebhook(@Req() req: RawBodyRequest<Request>) {
    const sig = req.headers['stripe-signature'] as string;
    return this.payments.handleWebhook(req.rawBody!, sig);
  }
}
