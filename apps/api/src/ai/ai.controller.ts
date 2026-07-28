import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AiService } from './ai.service';
import { AuthGuard, TenantGuard, RolesGuard, RequireTenantRole } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';

interface ChatMessage { role: 'user' | 'assistant'; content: string }

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private ai: AiService) {}

  // ── Authenticated staff/admin endpoints ───────────────────────────────────

  @Post('quote-assist')
  @UseGuards(TenantGuard, AuthGuard, RolesGuard)
  @RequireTenantRole('STAFF')
  quoteAssist(@CurrentTenant() tenantId: string, @Body() body: { quoteId: string }) {
    return this.ai.quoteAssist(tenantId, body.quoteId);
  }

  @Post('email-draft')
  @UseGuards(TenantGuard, AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  emailDraft(@CurrentTenant() tenantId: string, @Body() body: { quoteId: string; kind: string }) {
    return this.ai.emailDraft(tenantId, body.quoteId, body.kind);
  }

  @Get('insights')
  @UseGuards(TenantGuard, AuthGuard, RolesGuard)
  @RequireTenantRole('OWNER')
  insights(@CurrentTenant() tenantId: string) {
    return this.ai.insights(tenantId);
  }

  // ── Public chat widget (no auth, no TenantGuard) ──────────────────────────
  // Works on every page: tenant pages answer about that tenant (slug from the
  // X-Tenant-Slug header / JWT); platform pages with no tenant get the
  // platform-level assistant. Tenant id is read optionally from the request.

  @Post('chat')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  chat(
    @Req() req: { tenantContext?: { tenantId?: string | null } },
    @Body() body: { message: string; history?: ChatMessage[] },
  ) {
    const tenantId = req.tenantContext?.tenantId ?? null;
    return this.ai.chat(tenantId, body.message ?? '', body.history ?? []);
  }
}
