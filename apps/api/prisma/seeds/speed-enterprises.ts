import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SERVICE_TEMPLATES } from './service-templates';
import {
  BrandingSchema, ContactSchema, SchedulingSchema, AutomationSchema, AISchema,
  PaymentsSchema, FeaturesSchema, DEFAULT_OPERATING_HOURS,
} from '@speed-enterprises/shared';
import { DEFAULT_TEMPLATES } from '../../src/messaging/default-templates';

/**
 * Speed Enterprises — ported from the existing standalone app.
 * Window cleaning, Salt Lake City. Orange brand. Two services.
 */
export async function seedSpeedEnterprises(prisma: PrismaClient) {
  const slug = 'speedenterprises';
  let tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        slug,
        industry: 'WINDOW_CLEANING',
        status: 'ACTIVE',
        planTier: 'PRO',
        config: {
          create: {
            businessName: 'Speed Enterprises',
            legalName: 'Speed Enterprises LLC',
            tagline: 'Professional window cleaning you can trust.', branding: BrandingSchema.parse({
              logoUrl: 'http://localhost:3000/logos/speed-enterprises-logo.webp',
              faviconUrl: 'http://localhost:3000/logos/speed-enterprises-logo.webp',
              appIconUrl: 'http://localhost:3000/logos/speed-enterprises-logo.webp',
              ogImageUrl: 'http://localhost:3000/logos/speed-enterprises-banner.webp',
              wordmarkText: 'Speed Enterprises',
              fontFamily: 'inter',
              colors: {
                brand50: '#fff7ed', brand100: '#ffedd5', brand200: '#fed7aa',
                brand400: '#ea580c', brand500: '#c2410c', brand600: '#9a3412',
                brand700: '#7c2d12', brand900: '#431407',
                accent: '#1c1917', onBrand: '#ffffff',
              },
            }) as any,
            contact: ContactSchema.parse({
              publicPhone: '(801) 555-0100',
              publicEmail: 'speedenterprises801@gmail.com',
              notificationEmails: ['speedenterprises801@gmail.com'],
              emailFromAddress: 'speedenterprises801@gmail.com',
              emailFromName: 'Speed Enterprises',
              address: { city: 'Salt Lake City', state: 'UT', postalCode: '84084' },
              serviceAreas: [{
                label: 'Salt Lake City Metro',
                cities: ['Salt Lake City', 'Murray', 'Draper', 'Sandy', 'West Jordan', 'South Jordan', 'Cottonwood Heights', 'Taylorsville', 'Herriman', 'Midvale', 'West Valley City', 'Bluffdale', 'Riverton', 'Copperton', 'Sundance', 'Park City', 'Tooele', 'Uintah', 'Wasatch', 'Summit', 'Daggett', 'Davis', 'Weber', 'Morgan', 'Salt Lake', 'Utah', 'Box Elder', 'Cache', 'Rich', 'Bear Lake', 'Caribou', 'Emery', 'Grand', 'San Juan', 'Wayne', 'Piute', 'Garfield', 'Iron', 'Washington', 'Kane', 'Washington', 'Iron', 'Garfield', 'Piute', 'Wayne', 'San Juan', 'Grand', 'Emery', 'Caribou', 'Bear Lake', 'Rich', 'Cache', 'Box Elder', 'Utah', 'Salt Lake', 'Morgan', 'Weber', 'Davis', 'Daggett', 'Summit', 'Wasatch', 'Uintah', 'Duchesne', 'Tooele', 'Brighton', 'Alta' ],
               zipCodes: ['84084', '84101', '84102', '84103', '84104', '84105', '84106', '84107', '84108', '84109', '84111', '84112', '84113', '84115', '84116', '84117', '84118', '84119', '84120', '84121', '84122', '84123', '84124', '84128', '84129', '84130', '84133', '84138', '84139', '84141', '84143', '84145' ],
              }],
            }) as any,
            scheduling: SchedulingSchema.parse({
              timezone: 'America/Denver',
              operatingHours: DEFAULT_OPERATING_HOURS,
              emergencyAvailable: false,
            }) as any,
            automation: AutomationSchema.parse({ sendFollowUpIfNoResponse: true }) as any,
            ai: AISchema.parse({
              enabled: true,
              quoteAssistant: true,
              emailAssistant: true,
              businessInsights: true,
              imageAnalysis: true,
              brandVoice: 'Friendly, professional, and concise. Emphasize focus on customers wants and needs and the companies dedication to maintaining spotless results and a hassle-free process.',
            }) as any,
            payments: PaymentsSchema.parse({}) as any,
            features: FeaturesSchema.parse({
              residentialEnabled: true,
              commercialEnabled: true,
              publicQuoteFormEnabled: true,
            }) as any,
          },
        },
      },
    });
  }

  // Always update AI flags so re-seeds pick up new capabilities
  await prisma.tenantConfig.update({
    where: { tenantId: tenant.id },
    data: {
      ai: AISchema.parse({
        enabled: true,
        quoteAssistant: true,
        emailAssistant: true,
        businessInsights: true,
        imageAnalysis: true,
        brandVoice: 'Friendly, professional, and concise. Emphasize spotless results and a hassle free process.',
      }) as any,
    },
  });

  // Storefront hero uses the per-industry stock photo + animated hero clips, so
  // heroImageUrl stays unset; clear it from existing branding on re-seed.
  const cfgForHero = await prisma.tenantConfig.findUnique({
    where: { tenantId: tenant.id }, select: { branding: true },
  });
  const brandingNoHero = { ...((cfgForHero?.branding as any) ?? {}) };
  delete brandingNoHero.heroImageUrl;
  await prisma.tenantConfig.update({
    where: { tenantId: tenant.id },
    data: { branding: brandingNoHero as any },
  });

  // Default message templates
  await prisma.automationTemplate.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.automationTemplate.createMany({
    data: DEFAULT_TEMPLATES.map(t => ({
      tenantId: tenant!.id, kind: t.kind, channel: t.channel,
      subject: t.subject ?? null, body: t.body, enabled: t.enabled,
    })),
  });

  // Services (residential + commercial window cleaning).
  // UPSERT by (tenantId, slug) — service rows keep their ids across re-seeds,
  // so existing quotes' serviceId FKs stay valid and nothing needs wiping.
  const wcTemplates = SERVICE_TEMPLATES.filter(t => t.industry === 'WINDOW_CLEANING');
  for (const t of wcTemplates) {
    const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fields = {
      name: t.name, category: t.category, description: t.description,
      iconKey: t.iconKey, basePriceCents: t.recommendedBasePriceCents,
      pricingMode: t.pricingMode, questions: t.questions as any,
      pricingRules: t.pricingRules as any, lineItemKinds: t.lineItemKinds,
      capabilities: t.capabilities, sortOrder: t.sortOrder,
    };
    await prisma.service.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug } },
      create: { tenantId: tenant.id, slug, ...fields },
      update: fields,
    });
  }

  // Owner user + membership
  const ownerEmail = 'owner@speedenterprises.com';
  const ownerPassword = 'Speed!Owner2026';
  let owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash: await argon2.hash(ownerPassword, { type: argon2.argon2id }),
        platformRole: 'CUSTOMER',
        emailVerifiedAt: new Date(),
      },
    });
  }
  await prisma.tenantMembership.upsert({
    where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } },
    create: { userId: owner.id, tenantId: tenant.id, role: 'OWNER', fullName: 'Speed Enterprises Owner', acceptedAt: new Date() },
    update: { role: 'OWNER', active: true },
  });
  await prisma.customerProfile.upsert({
    where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } },
    create: { userId: owner.id, tenantId: tenant.id, fullName: 'Speed Enterprises Owner', phone: '(801) 555-0100' },
    update: {},
  });

  // eslint-disable-next-line no-console
  console.log(`✓ Speed Enterprises seeded — owner login: ${ownerEmail} / ${ownerPassword}`);
  return tenant;
}
