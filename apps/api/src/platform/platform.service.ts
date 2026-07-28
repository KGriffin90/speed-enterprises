import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { TenantProvisioningService } from '../database/tenant-provisioning.service';
import { MessagingService } from '../messaging/messaging.service';
import { DEFAULT_TEMPLATES } from '../messaging/default-templates';
import {
  CreateTenantDto, SetTenantStatusDto, InviteMemberDto, INDUSTRY_LABELS,
  BrandingSchema, ContactSchema, SchedulingSchema, AutomationSchema, AISchema,
  PaymentsSchema, FeaturesSchema, DEFAULT_OPERATING_HOURS,
} from '@speed-enterprises/shared';
import { AuditAction, TenantRole, TenantStatus, TokenPurpose } from '@prisma/client';

/**
 * Platform-admin operations. The tenant registry, users, memberships, and invite
 * tokens are CATALOG rows; a tenant's config, message templates, services, and
 * audit log live in that tenant's OWN database. Creating a tenant therefore:
 * write the registry row → provision its database → seed business data into it.
 * (In pool mode provisioning is a no-op and clientFor() returns the shared
 * client, so the same code runs unchanged before any cut-over.)
 */
@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);
  constructor(
    private catalog: CatalogPrismaService,
    private tenantDb: TenantDatabaseService,
    private provisioning: TenantProvisioningService,
    private messaging: MessagingService,
  ) {}

  // ── Tenant onboarding ────────────────────────────────────────────────────
  async createTenant(actorUserId: string, dto: CreateTenantDto) {
    if (RESERVED_SLUGS.has(dto.slug)) throw new BadRequestException('Reserved slug');
    const existing = await this.catalog.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('Slug already taken');

    const defaultBranding = BrandingSchema.parse({
      logoUrl:     `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(dto.businessName)}&backgroundType=gradientLinear`,
      faviconUrl:  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(dto.businessName)}&size=64`,
      appIconUrl:  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(dto.businessName)}&size=512`,
      wordmarkText: dto.businessName,
      colors: {
        brand50:  '#eef2ff', brand100: '#e0e7ff', brand200: '#c7d2fe',
        brand400: '#818cf8', brand500: '#6366f1', brand600: '#4f46e5',
        brand700: '#4338ca', brand900: '#1e1b4b',
        accent:   '#f59e0b', onBrand: '#ffffff',
      },
      ...(dto.branding ?? {}),
    });

    const defaultContact = ContactSchema.parse({
      publicPhone: '(000) 000-0000',
      publicEmail: dto.ownerEmail,
      notificationEmails: [dto.ownerEmail],
      address: { state: 'UT', postalCode: '00000' },
      serviceAreas: [{ label: 'Local area' }],
      ...(dto.contact ?? {}),
    });

    const defaultScheduling = SchedulingSchema.parse({
      timezone: 'America/Denver',
      operatingHours: DEFAULT_OPERATING_HOURS,
      ...(dto.scheduling ?? {}),
    });

    // 1. Registry row in the catalog (identity/control-plane).
    const tenant = await this.catalog.tenant.create({
      data: {
        slug:     dto.slug,
        industry: dto.industry,
        planTier: dto.planTier,
        status:   TenantStatus.TRIAL,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      },
    });

    // 2. Provision the tenant's dedicated database (no-op in pool mode).
    await this.provisioning.provision(tenant.id);

    // 3. Seed business data into the tenant's own database.
    const db = await this.tenantDb.clientFor(tenant.id);
    const config = await db.tenantConfig.create({
      data: {
        tenantId:     tenant.id,
        businessName: dto.businessName,
        legalName:    dto.legalName,
        tagline:      `Professional ${INDUSTRY_LABELS[dto.industry]}`,
        branding:   defaultBranding as any,
        contact:    defaultContact as any,
        scheduling: defaultScheduling as any,
        automation: AutomationSchema.parse({}) as any,
        ai:         AISchema.parse({}) as any,
        payments:   PaymentsSchema.parse({}) as any,
        features:   FeaturesSchema.parse({ ...(dto.features ?? {}) }) as any,
      },
    });

    // Seed default message templates
    await db.automationTemplate.createMany({
      data: DEFAULT_TEMPLATES.map(t => ({
        tenantId: tenant.id,
        kind:    t.kind,
        channel: t.channel,
        subject: t.subject ?? null,
        body:    t.body,
        enabled: t.enabled,
      })),
    });

    // Clone selected ServiceTemplate rows (templates are catalog; services are tenant DB)
    if (dto.serviceTemplateIds.length) {
      const templates = await this.catalog.serviceTemplate.findMany({
        where: { id: { in: dto.serviceTemplateIds } },
      });
      for (const t of templates) {
        await db.service.create({
          data: {
            tenantId:    tenant.id,
            slug:        toSlug(t.name),
            name:        t.name,
            category:    t.category,
            description: t.description,
            iconKey:     t.iconKey,
            basePriceCents: t.recommendedBasePriceCents,
            pricingMode: t.pricingMode,
            questions:   t.questions as any,
            pricingRules: t.pricingRules as any,
            lineItemKinds: t.lineItemKinds,
            capabilities:  t.capabilities,
            estimatedDurationMinutes: t.estimatedDurationMinutes,
            sortOrder:   t.sortOrder,
          },
        });
      }
    }

    // Invite the first owner via TENANT_INVITE token
    await this.inviteMember(actorUserId, tenant.id, {
      email: dto.ownerEmail, fullName: dto.ownerName, role: TenantRole.OWNER,
    });

    await db.auditLog.create({
      data: {
        tenantId: tenant.id, actorUserId, action: AuditAction.TENANT_CREATED,
        entityType: 'Tenant', entityId: tenant.id,
        metadata: { slug: dto.slug, industry: dto.industry, planTier: dto.planTier },
      },
    });
    return { ...tenant, config };
  }

  async listTenants() {
    // Registry from catalog; businessName + quote counts from each tenant DB;
    // membership counts from the catalog.
    const tenants = await this.catalog.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const out = [];
    for (const t of tenants) {
      const db = await this.tenantDb.clientFor(t.id);
      const [config, quoteRequests, memberships] = await Promise.all([
        db.tenantConfig.findUnique({ where: { tenantId: t.id }, select: { businessName: true } }),
        db.quoteRequest.count({ where: { tenantId: t.id } }),
        this.catalog.tenantMembership.count({ where: { tenantId: t.id } }),
      ]);
      out.push({ ...t, config, _count: { quoteRequests, memberships } });
    }
    return out;
  }

  async setStatus(actorUserId: string, id: string, dto: SetTenantStatusDto) {
    const tenant = await this.catalog.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException();
    await this.catalog.tenant.update({ where: { id }, data: { status: dto.status } });
    const db = await this.tenantDb.clientFor(id);
    await db.auditLog.create({
      data: {
        tenantId: tenant.id, actorUserId,
        action: dto.status === 'SUSPENDED' ? AuditAction.TENANT_SUSPENDED
              : dto.status === 'ARCHIVED'  ? AuditAction.TENANT_ARCHIVED
              : AuditAction.TENANT_REACTIVATED,
        entityType: 'Tenant', entityId: tenant.id,
        metadata: { from: tenant.status, to: dto.status },
      },
    });
    return this.catalog.tenant.findUnique({ where: { id } });
  }

  // ── Membership management ───────────────────────────────────────────────
  async inviteMember(actorUserId: string, tenantId: string, dto: InviteMemberDto) {
    const tenant = await this.catalog.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const email = dto.email.toLowerCase();
    const existingUser = await this.catalog.user.findUnique({ where: { email } });
    const db = await this.tenantDb.clientFor(tenantId);

    // If the user already exists, just create the membership immediately
    if (existingUser) {
      await this.catalog.tenantMembership.upsert({
        where:  { userId_tenantId: { userId: existingUser.id, tenantId } },
        create: {
          userId: existingUser.id, tenantId, role: dto.role,
          fullName: dto.fullName, invitedById: actorUserId, acceptedAt: new Date(),
        },
        update: { role: dto.role, active: true },
      });
      await db.auditLog.create({
        data: {
          tenantId, actorUserId, action: AuditAction.MEMBER_INVITED,
          entityType: 'User', entityId: existingUser.id,
          metadata: { role: dto.role, immediate: true },
        },
      });
      return { invited: true, immediate: true };
    }

    // Otherwise mint an invite token and email it
    const secret = crypto.randomBytes(32).toString('hex');
    await this.catalog.verificationToken.create({
      data: {
        tenantId, email,
        purpose:   TokenPurpose.TENANT_INVITE,
        tokenHash: sha256(secret),
        payload:   { role: dto.role, fullName: dto.fullName, invitedBy: actorUserId } as any,
        expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      },
    });

    const inviteUrl = `${process.env.WEB_ORIGIN}/invite?token=${encodeURIComponent(secret)}&slug=${tenant.slug}`;
    await this.messaging.sendForTenant({
      tenantId,
      kind: 'verify_email',  // reusing platform template; tenant-specific invite template comes in round-2
      toEmail: email,
      vars: {
        platformName: process.env.PLATFORM_NAME ?? 'Speed Enterprises',
        otp: 'INVITE',
        verifyUrl: inviteUrl,
      },
    });

    await db.auditLog.create({
      data: {
        tenantId, actorUserId, action: AuditAction.MEMBER_INVITED,
        entityType: 'Invite', entityId: email, metadata: { role: dto.role, immediate: false },
      },
    });
    return { invited: true, immediate: false, inviteUrlForDev: process.env.NODE_ENV !== 'production' ? inviteUrl : undefined };
  }
}

const RESERVED_SLUGS = new Set([
  'www', 'api', 'admin', 'platform', 'mail', 'app', 'docs', 'status',
  'public', 'internal', 'system', 'root', 'support', '_platform',
]);

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}
function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
