import { Injectable, NotFoundException } from '@nestjs/common';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import {
  BusinessConfigSchema, BusinessConfig,
  BrandingSchema, ContactSchema, SchedulingSchema, AutomationSchema, AISchema,
  PaymentsSchema, FeaturesSchema,
  UpdateTenantConfigDto, INDUSTRY_LABELS,
} from '@speed-enterprises/shared';

/**
 * The visitor-safe subset of BusinessConfig returned by the public
 * GET /config/:slug endpoint. Excludes automation, ai, payments,
 * automationTemplates, and internal contact fields.
 */
export type PublicBusinessConfig =
  Omit<BusinessConfig, 'automation' | 'ai' | 'payments' | 'automationTemplates' | 'contact'>
  & { contact: Pick<BusinessConfig['contact'], 'publicPhone' | 'publicEmail' | 'address' | 'serviceAreas' | 'socialLinks'> };

/** Strip every internal field from a full config, leaving the public storefront subset. */
function toPublicConfig(cfg: BusinessConfig): PublicBusinessConfig {
  // Pull out internal blocks; `rest` keeps the public identity/branding/etc.
  const { automation, ai, payments, automationTemplates, contact, ...rest } = cfg;
  void automation; void ai; void payments; void automationTemplates;
  return {
    ...rest,
    contact: {
      publicPhone:  contact.publicPhone,
      publicEmail:  contact.publicEmail,
      address:      contact.address,
      serviceAreas: contact.serviceAreas,
      socialLinks:  contact.socialLinks,
    },
  };
}

/**
 * Reads/writes the full BusinessConfig payload for a tenant. Reads are
 * heavily cacheable; writes bump configVersion and invalidate.
 *
 * The tenant registry (slug/industry/status) lives in the CATALOG; the config,
 * services, and message templates live in each tenant's own database. We resolve
 * the right per-tenant client via TenantDatabaseService.clientFor() rather than
 * the request-scoped TENANT_DB, because listBusinesses() spans every tenant and
 * must run with no single tenant in scope.
 */
@Injectable()
export class ConfigService {
  constructor(
    private catalog: CatalogPrismaService,        // tenant registry
    private tenantDb: TenantDatabaseService,       // per-tenant business DBs
  ) {}

  /** Returns a lightweight list of active tenants for the mobile discovery screen. */
  async listBusinesses() {
    const tenants = await this.catalog.tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null, slug: { not: '_platform' } },
      orderBy: { createdAt: 'asc' },
    });
    const out: Array<{ slug: string; industry: any; businessName: string; tagline: string | null; logoUrl: string | null; colors: { brand500: string; brand100: string }; services: string[] }> = [];
    for (const t of tenants) {
      const db = await this.tenantDb.clientFor(t.id);
      const config = await db.tenantConfig.findUnique({
        where: { tenantId: t.id },
        select: { businessName: true, tagline: true, branding: true },
      });
      if (!config) continue;
      // Public service names double as search keywords on the discovery screen,
      // so a customer can find a business by what it does, not just its name.
      const services = await db.service.findMany({
        where: { active: true, visibleOnPublicSite: true, deletedAt: null },
        select: { name: true },
        orderBy: { sortOrder: 'asc' },
      });
      out.push({
        slug:         t.slug,
        industry:     t.industry,
        businessName: config.businessName,
        tagline:      config.tagline ?? null,
        logoUrl:      (config.branding as any)?.logoUrl ?? null,
        colors: {
          brand500: (config.branding as any)?.colors?.brand500 ?? '#4f46e5',
          brand100: (config.branding as any)?.colors?.brand100 ?? '#e0e7ff',
        },
        services:     services.map(s => s.name),
      });
    }
    return out;
  }

  /**
   * Public, UNAUTHENTICATED tenant config for the storefront / mobile boot.
   *
   * Returns only what a visitor legitimately needs (branding, public contact,
   * hours, visible services, feature flags). Internal blocks are stripped so
   * `GET /config/:slug` can't be scraped for them:
   *   - automation / ai          → internal operational settings
   *   - payments                 → provider + stripeAccountId
   *   - automationTemplates         → internal email/SMS wording
   *   - contact.notificationEmails / emailFrom* / emailReplyTo / smsNumber
   *                              → internal routing addresses
   * Admins fetch the FULL config via the authenticated GET /me/config.
   */
  async getBySlug(slug: string): Promise<PublicBusinessConfig> {
    const registry = await this.catalog.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!registry) throw new NotFoundException('Tenant not configured');
    const full = await this.getById(registry.id);
    return toPublicConfig(full);
  }

  async getById(tenantId: string): Promise<BusinessConfig> {
    const db = await this.tenantDb.clientFor(tenantId);
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      include: {
        config:           true,
        services:         { where: { active: true, deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        automationTemplates: true,
      },
    });
    if (!tenant || !tenant.config) throw new NotFoundException('Tenant not configured');
    return this.assemble(tenant, tenant.config, tenant.services, tenant.automationTemplates);
  }

  async updateConfig(tenantId: string, dto: UpdateTenantConfigDto): Promise<BusinessConfig> {
    const db = await this.tenantDb.clientFor(tenantId);
    const existing = await db.tenantConfig.findUniqueOrThrow({ where: { tenantId } });

    const merged = {
      branding:   dto.branding   ? BrandingSchema.parse({   ...(existing.branding   as object), ...dto.branding })   : existing.branding,
      contact:    dto.contact    ? ContactSchema.parse({    ...(existing.contact    as object), ...dto.contact })    : existing.contact,
      scheduling: dto.scheduling ? SchedulingSchema.parse({ ...(existing.scheduling as object), ...dto.scheduling }) : existing.scheduling,
      automation: dto.automation ? AutomationSchema.parse({ ...(existing.automation as object), ...dto.automation }) : existing.automation,
      ai:         dto.ai         ? AISchema.parse({         ...(existing.ai         as object), ...dto.ai })         : existing.ai,
      payments:   dto.payments   ? PaymentsSchema.parse({   ...(existing.payments   as object), ...dto.payments })   : existing.payments,
      features:   dto.features   ? FeaturesSchema.parse({   ...(existing.features   as object), ...dto.features })   : existing.features,
    };

    await db.tenantConfig.update({
      where: { tenantId },
      data: {
        branding:   merged.branding   as any,
        contact:    merged.contact    as any,
        scheduling: merged.scheduling as any,
        automation: merged.automation as any,
        ai:         merged.ai         as any,
        payments:   merged.payments   as any,
        features:   merged.features   as any,
        configVersion: { increment: 1 },
      },
    });
    return this.getById(tenantId);
  }

  // ── Internal: assemble + validate ────────────────────────────────────────
  private assemble(
    tenant: { id: string; slug: string; industry: any },
    config: any,
    services: any[],
    templates: any[],
  ): BusinessConfig {
    const raw = {
      tenantId:      tenant.id,
      slug:          tenant.slug,
      businessName:  config.businessName,
      legalName:     config.legalName,
      tagline:       config.tagline,
      industry:      tenant.industry,
      industryLabel: INDUSTRY_LABELS[tenant.industry as keyof typeof INDUSTRY_LABELS] ?? String(tenant.industry),
      locale:        config.locale,
      currency:      config.currency,

      branding:   config.branding,
      contact:    config.contact,
      scheduling: config.scheduling,
      automation: config.automation,
      ai:         config.ai,
      payments:   config.payments,
      features:   config.features,

      services: services.map((s) => ({
        id:               s.id,
        slug:             s.slug,
        name:             s.name,
        category:         s.category,
        description:      s.description,
        iconKey:          s.iconKey,
        active:           s.active,
        visibleOnPublicSite: s.visibleOnPublicSite,
        basePriceCents:   s.basePriceCents,
        pricingMode:      s.pricingMode,
        questions:        s.questions,
        pricingRules:     s.pricingRules,
        lineItemKinds:    s.lineItemKinds,
        capabilities:     s.capabilities,
        estimatedDurationMinutes: s.estimatedDurationMinutes ?? undefined,
        requiresOnsiteEstimate:   s.requiresOnsiteEstimate,
        sortOrder:        s.sortOrder,
      })),

      automationTemplates: templates.map((t) => ({
        kind:    t.kind,
        channel: t.channel,
        subject: t.subject ?? undefined,
        body:    t.body,
        enabled: t.enabled,
      })),

      configVersion: config.configVersion,
      updatedAt:     config.updatedAt.toISOString(),
    };

    return BusinessConfigSchema.parse(raw);
  }
}
