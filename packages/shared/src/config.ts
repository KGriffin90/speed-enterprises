/**
 * BusinessConfig — the single, validated runtime contract that describes a
 * tenant. Same shape used by the API, web, and mobile.
 *
 * Storage model:
 *   - Identity fields (slug, businessName, industry, …) → columns on `Tenant`.
 *   - Modules (branding, contact, scheduling, automation, ai, payments,
 *     features) → JSONB columns on `TenantConfig`.
 *   - Services and AutomationTemplates → their own per-tenant tables (joined
 *     into the BusinessConfig payload by the /config endpoint).
 *
 * Money is always integer cents — never floats.
 */

import { z } from 'zod';
import {
  Industry,
  ServiceCategory,
  PricingMode,
  MessageChannel,
  MessageKind,
  LineItemKind,
} from './enums';

// ── Primitive helpers ───────────────────────────────────────────────────────
export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB hex color');

export const E164 = z.string().regex(/^\+?[1-9]\d{6,14}$/, 'Expected E.164 phone (digits, optional +)');
export const IanaTimezone = z.string().min(3); // not fully validated; runtime check by Intl in API
export const Slug = z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, hyphens only');
export const Cents = z.number().int().nonnegative();
export const Percent = z.number().min(0).max(100);

// ── Branding ────────────────────────────────────────────────────────────────
export const FontFamilyKey = z.enum([
  'inter',
  'montserrat',
  'manrope',
  'plus-jakarta',
  'dm-sans',
  'system',
]);
export type FontFamilyKey = z.infer<typeof FontFamilyKey>;

export const ColorTokens = z.object({
  brand50:  HexColor,
  brand100: HexColor,
  brand200: HexColor,
  brand400: HexColor,
  brand500: HexColor,
  brand600: HexColor,
  brand700: HexColor,
  brand900: HexColor,
  accent:   HexColor,
  onBrand:  HexColor, // text color on top of brand500 surfaces
});
export type ColorTokens = z.infer<typeof ColorTokens>;

export const BrandingSchema = z.object({
  logoUrl:     z.string().url(),
  logoDarkUrl: z.string().url().optional(),
  faviconUrl:  z.string().url(),
  appIconUrl:  z.string().url(),
  ogImageUrl:  z.string().url().optional(),
  /** Full-bleed trade photo rendered at light opacity behind the landing /
   *  storefront hero on web and mobile. Falls back to per-slug/industry maps
   *  in each client when unset. */
  heroImageUrl: z.string().url().optional(),
  /** Short, muted, looping trade-type video played full-bleed behind the
   *  storefront hero (under the same wash as heroImageUrl). When unset, the web
   *  client falls back to a per-industry stock clip; heroImageUrl is the poster
   *  / reduced-motion fallback. */
  heroVideoUrl: z.string().url().optional(),
  wordmarkText: z.string().min(1).max(60),
  fontFamily:   FontFamilyKey.default('inter'),
  colors:       ColorTokens,
  cornerRadius: z.enum(['sharp', 'soft', 'rounded']).default('soft'),
  density:      z.enum(['comfortable', 'compact']).default('comfortable'),
});
export type Branding = z.infer<typeof BrandingSchema>;

// ── Contact + service area ──────────────────────────────────────────────────
export const ServiceAreaSchema = z.object({
  label:   z.string(),
  cities:  z.array(z.string()).optional(),
  zipCodes: z.array(z.string()).optional(),
  /** [lng, lat] polygon for geo-fence lookups (optional). */
  polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
  travelFeePolicy: z.enum(['none', 'flat', 'per_mile']).default('none'),
  travelFeeCents: Cents.optional(),
  travelFeePerMileCents: Cents.optional(),
});
export type ServiceArea = z.infer<typeof ServiceAreaSchema>;

/**
 * Address shape used both for business contact info (where `line1`/`city`
 * may be absent for mobile-only or appointment-only businesses) and for
 * customer service addresses (where everything is typically populated).
 * For stricter cases see `ServiceAddressSchema`.
 */
export const AddressSchema = z.object({
  line1:      z.string().optional(),
  line2:      z.string().optional(),
  city:       z.string().optional(),
  state:      z.string().length(2),
  postalCode: z.string().min(3).max(12),
  country:    z.string().length(2).default('US'),
});
export type Address = z.infer<typeof AddressSchema>;

/** Stricter variant — used when an address is needed for dispatch/invoicing. */
export const ServiceAddressSchema = AddressSchema.extend({
  line1: z.string().min(1),
  city:  z.string().min(1),
});
export type ServiceAddress = z.infer<typeof ServiceAddressSchema>;

export const ContactSchema = z.object({
  publicPhone:        z.string(),
  publicEmail:        z.string().email(),
  notificationEmails: z.array(z.string().email()).min(1),
  smsNumber:          E164.optional(),
  /** From-address override. If absent, platform default is used (platform.support@…). */
  emailFromAddress:   z.string().email().optional(),
  emailFromName:      z.string().max(60).optional(),
  emailReplyTo:       z.string().email().optional(),
  address:            AddressSchema,
  serviceAreas:       z.array(ServiceAreaSchema).min(1),
  socialLinks: z.object({
    website:               z.string().url().optional(),
    facebook:              z.string().url().optional(),
    instagram:             z.string().url().optional(),
    yelp:                  z.string().url().optional(),
    googleBusinessProfile: z.string().url().optional(),
    nextdoor:              z.string().url().optional(),
  }).default({}),
});
export type Contact = z.infer<typeof ContactSchema>;

// ── Scheduling ──────────────────────────────────────────────────────────────
const DayKey = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type DayKey = z.infer<typeof DayKey>;

export const DayHours = z.union([
  z.literal('closed'),
  z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) }),
]);
export type DayHours = z.infer<typeof DayHours>;

export const SchedulingSchema = z.object({
  timezone:         IanaTimezone,
  operatingHours:   z.record(DayKey, DayHours),
  emergencyAvailable: z.boolean().default(false),
  bookingLeadTimeHours: z.number().int().nonnegative().default(24),
  bookingHorizonDays:   z.number().int().positive().default(60),
  slotDurationMinutes:  z.number().int().positive().default(60),
  bufferMinutes:        z.number().int().nonnegative().default(15),
  maxConcurrentJobs:    z.number().int().positive().default(1),
  reminderOffsetsHours: z.array(z.number()).default([48, 24, 2]),
  /** Calendar dates the business is closed (ISO YYYY-MM-DD). */
  blackoutDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
});
export type Scheduling = z.infer<typeof SchedulingSchema>;

// ── Quote-question schema ───────────────────────────────────────────────────
export const QuestionOption = z.object({
  value: z.string(),
  label: z.string(),
  /** Optional: this option contributes to pricing on its own. */
  priceAdjustmentCents: z.number().int().optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

export const QuestionTypeKey = z.enum([
  'text',
  'longtext',
  'number',
  'currency',
  'select',
  'multiselect',
  'boolean',
  'date',
  'time',
  'address',
  'photo',
  'video',
  'file',
  'measurement',  // triggers AR/scanner UI on mobile (paired with capability)
  'rating',
]);
export type QuestionTypeKey = z.infer<typeof QuestionTypeKey>;

export const QuestionConditional = z.object({
  /** Show this question only when ALL of these match. */
  all: z.array(z.object({
    questionId: z.string(),
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'truthy', 'falsy']),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
  })).optional(),
  /** ...or when ANY of these match. */
  any: z.array(z.object({
    questionId: z.string(),
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'truthy', 'falsy']),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
  })).optional(),
});
export type QuestionConditional = z.infer<typeof QuestionConditional>;

export const QuestionSchema = z.object({
  id:          z.string().min(1).max(60),
  label:       z.string().min(1),
  type:        QuestionTypeKey,
  required:    z.boolean().optional().default(false),
  helpText:    z.string().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  options:     z.array(QuestionOption).optional(),
  min:         z.number().optional(),
  max:         z.number().optional(),
  step:        z.number().optional(),
  unit:        z.string().optional(),       // "sqft", "ft", "windows", "vents"
  maxFiles:    z.number().int().positive().optional(),
  acceptedMimeTypes: z.array(z.string()).optional(),
  conditional: QuestionConditional.optional(),
  affectsPricing: z.boolean().optional().default(false),
  internal:       z.boolean().optional().default(false),  // staff-only field
});
/** Parsed (output) shape. Defaults are populated. */
export type Question = z.infer<typeof QuestionSchema>;
/** Input shape (what you pass to .parse() or write as a literal). Defaults optional. */
export type QuestionInput = z.input<typeof QuestionSchema>;

// ── Pricing rules (computed-pricing engine) ─────────────────────────────────
const PricingCondition = z.object({
  questionId: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'truthy', 'falsy']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
});

const PricingEffect = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'),       cents: z.number().int() }),
  z.object({ kind: z.literal('multiply'),  factor: z.number().positive() }),
  z.object({ kind: z.literal('per_unit'),  questionId: z.string(), cents: z.number().int() }),
  z.object({
    kind: z.literal('tier'),
    questionId: z.string(),
    tiers: z.array(z.object({ upTo: z.number(), cents: z.number().int() })).min(1),
  }),
  z.object({
    kind: z.literal('volume_discount'),
    questionId: z.string(),
    thresholds: z.array(z.object({ atLeast: z.number(), percentOff: Percent })).min(1),
  }),
  z.object({ kind: z.literal('min_price'), cents: Cents }),
  z.object({ kind: z.literal('max_price'), cents: Cents }),
]);

export const PricingRuleSchema = z.object({
  id:     z.string(),
  label:  z.string(),
  /** ALL of these must be true (omit `when` for an always-on rule). */
  when:   z.array(PricingCondition).optional(),
  effect: PricingEffect,
  order:  z.number().int().optional().default(0), // lower runs first
});
export type PricingRule = z.infer<typeof PricingRuleSchema>;
export type PricingRuleInput = z.input<typeof PricingRuleSchema>;

// ── Line-item payload shapes ────────────────────────────────────────────────
/**
 * QuoteLineItem.payload schemas keyed by LineItemKind. Used by the pricing
 * engine and by the UI to render each line item type.
 */
export const LineItemPayloadSchemas = {
  window: z.object({
    widthInches:  z.number().positive(),
    heightInches: z.number().positive(),
    location:     z.string().optional(),  // "Living room"
    requiresLadder: z.boolean().optional(),
    stories:      z.number().int().positive().optional(),
  }),
  fixture: z.object({
    fixtureType: z.string(),    // "kitchen-sink", "toilet", "ceiling-fan"
    location:    z.string().optional(),
  }),
  unit: z.object({
    unitType: z.string(),       // "furnace", "ac-condenser", "water-heater"
    brand:    z.string().optional(),
    model:    z.string().optional(),
    age:      z.number().int().nonnegative().optional(),
  }),
  sqft_zone: z.object({
    sqft:  z.number().positive(),
    label: z.string().optional(),
    surfaceType: z.string().optional(),
  }),
  room: z.object({
    name: z.string(),
    sizeKey: z.enum(['small', 'medium', 'large', 'xl']).optional(),
  }),
  linear_ft: z.object({
    feet:        z.number().positive(),
    label:       z.string().optional(),
  }),
  pest_treatment: z.object({
    pestType:    z.string(),
    severity:    z.enum(['light', 'moderate', 'severe']).optional(),
  }),
  misc: z.object({
    description: z.string(),
  }),
} as const;
export type LineItemPayloadSchemas = typeof LineItemPayloadSchemas;

export function getLineItemPayloadSchema(kind: LineItemKind) {
  return LineItemPayloadSchemas[kind];
}

// ── Service ─────────────────────────────────────────────────────────────────
export const CapabilityKey = z.enum([
  'photo_upload',
  'video_upload',
  'voice_note',
  'window_rectangle_scan',  // iOS Vision rectangle detector
  'ar_measurement',         // generic ARKit/ARCore measurement
  'map_polygon',            // draw a polygon on a map (landscaping)
  'nameplate_ocr',          // photograph + OCR a unit nameplate
  'address_autocomplete',
  'date_picker',
  'time_picker',
  'multi_property',         // commercial: multiple sites in one quote
]);
export type CapabilityKey = z.infer<typeof CapabilityKey>;

export const ServiceSchema = z.object({
  id:           z.string(),                  // matches DB row id (cuid)
  slug:         z.string(),                  // unique within tenant
  name:         z.string().min(1),
  category:     ServiceCategory,
  description:  z.string(),
  iconKey:      z.string().optional(),
  active:       z.boolean().default(true),
  visibleOnPublicSite: z.boolean().default(true),
  basePriceCents: Cents.default(0),
  pricingMode:    PricingMode,
  questions:      z.array(QuestionSchema).default([]),
  pricingRules:   z.array(PricingRuleSchema).default([]),
  /** Kinds of QuoteLineItem this service produces. */
  lineItemKinds:  z.array(LineItemKind).default([]),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  requiresOnsiteEstimate:   z.boolean().default(false),
  capabilities:   z.array(CapabilityKey).default(['photo_upload']),
  sortOrder:      z.number().int().default(0),
});
export type Service = z.infer<typeof ServiceSchema>;

// ── Automation templates (the wording of the automated customer messages) ────
export const AutomationTemplateSchema = z.object({
  kind:    MessageKind,
  channel: MessageChannel,
  subject: z.string().optional(),  // email only
  body:    z.string().min(1),      // Markdown + Handlebars-style {{placeholders}}
  enabled: z.boolean().default(true),
});
export type AutomationTemplate = z.infer<typeof AutomationTemplateSchema>;

// ── Automation ──────────────────────────────────────────────────────────────
export const AutomationSchema = z.object({
  sendCustomerConfirmation:           z.boolean().default(true),
  sendAdminNotification:              z.boolean().default(true),
  sendFollowUpIfNoResponse:           z.boolean().default(true),
  followUpAfterHours:                 z.number().int().positive().default(24),
  followUpMaxAttempts:                z.number().int().positive().default(2),
  sendReviewRequestAfterCompletion:   z.boolean().default(true),
  reviewRequestDelayHours:            z.number().int().nonnegative().default(24),
  autoCloseStaleQuotesDays:           z.number().int().positive().default(30),
  autoExpireEstimatesDays:            z.number().int().positive().default(14),
  sendReferralRequestAfterReview:     z.boolean().default(false),
});
export type Automation = z.infer<typeof AutomationSchema>;

// ── AI ──────────────────────────────────────────────────────────────────────
export const AISchema = z.object({
  enabled:             z.boolean().default(false),
  quoteAssistant:      z.boolean().default(false),
  emailAssistant:      z.boolean().default(false),
  schedulingAssistant: z.boolean().default(false),
  leadScoring:         z.boolean().default(false),
  businessInsights:    z.boolean().default(false),
  imageAnalysis:       z.boolean().default(false),
  voiceTranscription:  z.boolean().default(false),
  modelPreferences: z.object({
    text:   z.enum(['claude-haiku', 'claude-sonnet', 'claude-opus']).default('claude-haiku'),
    vision: z.enum(['claude-sonnet', 'claude-opus']).default('claude-sonnet'),
  }).default({ text: 'claude-haiku', vision: 'claude-sonnet' }),
  /** Tenant-supplied tone/voice guidance for AI-generated drafts. */
  brandVoice: z.string().max(2000).optional(),
});
export type AI = z.infer<typeof AISchema>;

// ── Payments ────────────────────────────────────────────────────────────────
export const PaymentsSchema = z.object({
  enabled:         z.boolean().default(false),
  provider:        z.enum(['stripe']).default('stripe'),
  stripeAccountId: z.string().optional(),
  acceptedMethods: z.array(z.enum(['card', 'ach', 'apple_pay', 'google_pay'])).default(['card']),
  depositPolicy: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('flat'),    cents: Cents }),
    z.object({ kind: z.literal('percent'), percent: Percent }),
  ]).default({ kind: 'none' }),
  invoiceDueDays: z.number().int().nonnegative().default(0),
  lateFeePolicy: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('flat'),    cents: Cents }),
    z.object({ kind: z.literal('percent'), percent: Percent, graceDays: z.number().int().nonnegative() }),
  ]).default({ kind: 'none' }),
  taxPolicy: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('flat_percent'), percent: Percent }),
    z.object({ kind: z.literal('stripe_tax') }),
  ]).default({ kind: 'none' }),
});
export type Payments = z.infer<typeof PaymentsSchema>;

// ── Features ────────────────────────────────────────────────────────────────
export const FeaturesSchema = z.object({
  residentialEnabled:        z.boolean().default(true),
  commercialEnabled:         z.boolean().default(true),
  emergencyRequests:         z.boolean().default(false),
  customerAccountsRequired:  z.boolean().default(true),
  schedulingEnabled:         z.boolean().default(true),
  paymentsEnabled:           z.boolean().default(false),
  invoicingEnabled:          z.boolean().default(false),
  reviewsEnabled:            z.boolean().default(true),
  referralsEnabled:          z.boolean().default(false),
  inAppChat:                 z.boolean().default(false),
  multiLanguage:             z.boolean().default(false),
  customDomain:              z.boolean().default(false),
  whiteLabelMobileApp:       z.boolean().default(false),
  publicQuoteFormEnabled:    z.boolean().default(true),   // anonymous quote requests
  guestCheckoutEnabled:      z.boolean().default(false),
  multiPropertyQuotes:       z.boolean().default(false),
  recurringServicesEnabled:  z.boolean().default(false),
});
export type Features = z.infer<typeof FeaturesSchema>;

// ── The whole config ────────────────────────────────────────────────────────
export const BusinessConfigSchema = z.object({
  tenantId:      z.string(),
  slug:          Slug,
  businessName:  z.string().min(1).max(120),
  legalName:     z.string().min(1).max(160),
  tagline:       z.string().max(160).optional(),
  industry:      Industry,
  industryLabel: z.string(),
  locale:        z.string().default('en-US'),
  currency:      z.string().length(3).default('USD'),

  branding:         BrandingSchema,
  contact:          ContactSchema,
  scheduling:       SchedulingSchema,
  services:         z.array(ServiceSchema),
  automationTemplates: z.array(AutomationTemplateSchema),
  automation:       AutomationSchema,
  ai:               AISchema,
  payments:         PaymentsSchema,
  features:         FeaturesSchema,

  configVersion: z.number().int().positive(),
  updatedAt:     z.string(),
});
export type BusinessConfig = z.infer<typeof BusinessConfigSchema>;

// ── Convenience: validate + parse ───────────────────────────────────────────
export function parseBusinessConfig(raw: unknown): BusinessConfig {
  return BusinessConfigSchema.parse(raw);
}

export function safeParseBusinessConfig(raw: unknown) {
  return BusinessConfigSchema.safeParse(raw);
}

// ── Defaults factory (used by tenant-onboarding wizard) ─────────────────────
export const DEFAULT_AUTOMATION: Automation = AutomationSchema.parse({});
export const DEFAULT_AI: AI = AISchema.parse({});
export const DEFAULT_PAYMENTS: Payments = PaymentsSchema.parse({});
export const DEFAULT_FEATURES: Features = FeaturesSchema.parse({});

export const DEFAULT_OPERATING_HOURS: Record<DayKey, DayHours> = {
  mon: { open: '08:00', close: '17:00' },
  tue: { open: '08:00', close: '17:00' },
  wed: { open: '08:00', close: '17:00' },
  thu: { open: '08:00', close: '17:00' },
  fri: { open: '08:00', close: '17:00' },
  sat: { open: '09:00', close: '14:00' },
  sun: 'closed',
};
