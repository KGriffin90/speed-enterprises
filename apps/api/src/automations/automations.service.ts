import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../database/tenant-db.provider';
import { MessageKind, MessageChannel, AutomationTemplateSchema } from '@speed-enterprises/shared';
import { DEFAULT_TEMPLATES } from '../messaging/default-templates';
import { renderMessage } from '../messaging/email-renderer';
import { BrandingSchema, type Branding } from '@speed-enterprises/shared';

// Automations = the tenant's customer-message templates. Single-plane service
// (AutomationTemplate + TenantConfig live in the tenant DB), only injected by its
// own controller — safe to route through the request-scoped TENANT_DB client.
@Injectable()
export class AutomationsService {
  constructor(@Inject(TENANT_DB) private prisma: PrismaClient) {}

  async list(tenantId: string) {
    const rows = await this.prisma.automationTemplate.findMany({
      where: { tenantId },
      orderBy: [{ kind: 'asc' }, { channel: 'asc' }],
    });
    // Merge with defaults so the UI can see kinds that the tenant hasn't customized
    const seen = new Set(rows.map(r => `${r.kind}:${r.channel}`));
    const defaults = DEFAULT_TEMPLATES.filter(t => !seen.has(`${t.kind}:${t.channel}`)).map(t => ({
      id: null, tenantId,
      kind: t.kind, channel: t.channel,
      subject: t.subject ?? null, body: t.body,
      enabled: t.enabled,
      isCustomized: false,
    }));
    return [
      ...rows.map(r => ({ ...r, isCustomized: true })),
      ...defaults,
    ].sort((a, b) => (a.kind + a.channel).localeCompare(b.kind + b.channel));
  }

  async get(tenantId: string, kind: string, channel: string) {
    const row = await this.prisma.automationTemplate.findUnique({
      where: { tenantId_kind_channel: { tenantId, kind, channel: channel as any } },
    });
    if (row) return { ...row, isCustomized: true };
    const fallback = DEFAULT_TEMPLATES.find(t => t.kind === kind && t.channel === channel);
    if (!fallback) throw new NotFoundException();
    return { id: null, tenantId, kind, channel, subject: fallback.subject ?? null, body: fallback.body, enabled: fallback.enabled, isCustomized: false };
  }

  async upsert(tenantId: string, kind: string, channel: string, dto: { subject?: string; body: string; enabled?: boolean }) {
    AutomationTemplateSchema.parse({
      kind: kind as any, channel: channel as any,
      subject: dto.subject, body: dto.body, enabled: dto.enabled ?? true,
    });
    return this.prisma.automationTemplate.upsert({
      where:  { tenantId_kind_channel: { tenantId, kind, channel: channel as any } },
      create: { tenantId, kind, channel: channel as any, subject: dto.subject ?? null, body: dto.body, enabled: dto.enabled ?? true },
      update: { subject: dto.subject ?? null, body: dto.body, enabled: dto.enabled ?? true },
    });
  }

  async resetToDefault(tenantId: string, kind: string, channel: string) {
    await this.prisma.automationTemplate.deleteMany({
      where: { tenantId, kind, channel: channel as any },
    });
  }

  /** Render a preview of a template against fake vars, so admins can see the result. */
  async preview(tenantId: string, kind: string, channel: string, body?: string, subject?: string) {
    const cfg = await this.prisma.tenantConfig.findUnique({ where: { tenantId } });
    let branding: Branding | null = null;
    let businessName = cfg?.businessName ?? 'Your Business';
    if (cfg) {
      const parsed = BrandingSchema.safeParse(cfg.branding);
      if (parsed.success) branding = parsed.data;
    }
    const tpl = await this.get(tenantId, kind, channel);
    const useBody    = body    ?? tpl.body;
    const useSubject = subject ?? tpl.subject ?? '';
    const rendered = renderMessage({
      body: useBody,
      subject: useSubject,
      vars: FAKE_VARS(businessName),
      branding,
      businessName,
      platformName: process.env.PLATFORM_NAME ?? 'Speed Enterprises',
    });
    return rendered;
  }
}

function FAKE_VARS(businessName: string): Record<string, string> {
  return {
    businessName,
    businessEmail: 'hello@example.com',
    businessPhone: '(555) 555-0100',
    platformName:  process.env.PLATFORM_NAME ?? 'Speed Enterprises',
    webOrigin:     process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    customerFirstName: 'Jamie',
    customerName:      'Jamie Customer',
    customerEmail:     'jamie@example.com',
    customerPhone:     '(555) 555-0200',
    customerNotes:     '—',
    customerNote:      '',
    quoteId:           'cqu_demo123',
    quoteUrl:          `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/dashboard/quotes/cqu_demo123`,
    quoteAmount:       '$320.00',
    serviceName:       'Residential Window Cleaning',
    address:           '742 Evergreen Terrace, Salt Lake City UT 84101',
    scheduledAt:       new Date(Date.now() + 86400000).toISOString(),
    invoiceUrl:        `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/dashboard/quotes/cqu_demo123/invoice`,
    reviewUrl:         'https://google.com/maps/place/example',
    otp:               '123456',
    verifyUrl:         `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/auth/verify?token=demo`,
    resetUrl:          `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/auth/reset-password?token=demo`,
    estimateMessage:   'Thanks for the opportunity. Two crew, half-day visit. Photos welcome.',
  };
}
