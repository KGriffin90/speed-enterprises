/**
 * Platform-wide enums. These are intentionally narrow — they describe the
 * trade-business *lifecycle*, not the *content* of any one trade. Anything
 * that varies between industries (HomeType, BusinessType, Frequency, etc.)
 * is modeled as dynamic data in `Service.questions`, not as an enum here.
 */

import { z } from 'zod';

// ── Industry catalog ────────────────────────────────────────────────────────
export const Industry = z.enum([
  'WINDOW_CLEANING',
  'HVAC',
  'PLUMBING',
  'ELECTRICAL',
  'LANDSCAPING',
  'GENERAL_CONTRACTING',
  'ROOFING',
  'CLEANING',
  'PAINTING',
  'PEST_CONTROL',
  'HANDYMAN',
  'CONCRETE_ASPHALT',
  'AUTO_DETAIL',
  'POOL_SERVICE',
  'APPLIANCE_REPAIR',
  'SOLAR',
  // ── Expanded trade catalog ──────────────────────────────────────────────
  'GUTTERS',
  'SIDING',
  'GLASS',
  'GARAGE_DOOR',
  'FLOORING',
  'CABINETS_COUNTERTOPS',
  'FENCING',
  'DECK_PATIO',
  'LOCKSMITH',
  'MOVING',
  'JUNK_REMOVAL',
  'SEPTIC',
  'RADON',
  'RESTORATION',
  'INSULATION',
  'CHIMNEY',
  'WINDOW_TREATMENTS',
  'SECURITY_SMART_HOME',
  'EV_CHARGER',
  'COMMERCIAL_MAINTENANCE',
  'OTHER',
]);
export type Industry = z.infer<typeof Industry>;

export const INDUSTRY_LABELS: Record<Industry, string> = {
  WINDOW_CLEANING:     'Window Cleaning',
  HVAC:                'HVAC',
  PLUMBING:            'Plumbing',
  ELECTRICAL:          'Electrical',
  LANDSCAPING:         'Landscaping',
  GENERAL_CONTRACTING: 'General Contracting',
  ROOFING:             'Roofing',
  CLEANING:            'Cleaning',
  PAINTING:            'Painting',
  PEST_CONTROL:        'Pest Control',
  HANDYMAN:            'Handyman',
  CONCRETE_ASPHALT:    'Concrete & Asphalt',
  AUTO_DETAIL:         'Auto Detailing',
  POOL_SERVICE:        'Pool Service',
  APPLIANCE_REPAIR:    'Appliance Repair',
  SOLAR:               'Solar',
  GUTTERS:               'Gutters',
  SIDING:                'Siding',
  GLASS:                 'Glass & Windows',
  GARAGE_DOOR:           'Garage Doors',
  FLOORING:              'Flooring',
  CABINETS_COUNTERTOPS:  'Cabinets & Countertops',
  FENCING:               'Fencing',
  DECK_PATIO:            'Decks & Patios',
  LOCKSMITH:             'Locksmith',
  MOVING:                'Moving',
  JUNK_REMOVAL:          'Junk Removal',
  SEPTIC:                'Septic',
  RADON:                 'Radon Mitigation',
  RESTORATION:           'Restoration',
  INSULATION:            'Insulation',
  CHIMNEY:               'Chimney & Fireplace',
  WINDOW_TREATMENTS:     'Window Treatments',
  SECURITY_SMART_HOME:   'Security & Smart Home',
  EV_CHARGER:            'EV Charging',
  COMMERCIAL_MAINTENANCE:'Commercial Maintenance',
  OTHER:               'Other',
};

// ── Quote lifecycle ─────────────────────────────────────────────────────────
// The flow is mostly automatic: a quote moves NEW → REVIEWING (owner opens it)
// → ESTIMATE_SENT (owner sends the estimate + a proposed time) → SCHEDULED
// (customer approves a time) → IN_PROGRESS (job's start day) → COMPLETED (after
// the job). CANCELED is the owner's only manual move and is reachable from any
// active state. PAID follows COMPLETED via the payment flow.
export const QuoteStatus = z.enum([
  'NEW',            // submitted by customer, not yet seen
  'REVIEWING',      // owner has opened it and is preparing an estimate
  'ESTIMATE_SENT',  // owner sent an estimate + proposed time; awaiting customer
  'SCHEDULED',      // customer approved a time; job is on the calendar
  'IN_PROGRESS',    // crew is working it (start day reached)
  'COMPLETED',      // job done
  'PAID',           // payment received
  'CANCELED',
]);
export type QuoteStatus = z.infer<typeof QuoteStatus>;

// Helper: which transitions are legal. CANCELED is reachable from every active
// state (the owner's only manual move); everything else advances automatically.
export const LEGAL_STATUS_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  NEW:           ['REVIEWING', 'CANCELED'],
  REVIEWING:     ['ESTIMATE_SENT', 'CANCELED'],
  ESTIMATE_SENT: ['SCHEDULED', 'CANCELED'],
  SCHEDULED:     ['IN_PROGRESS', 'CANCELED'],
  IN_PROGRESS:   ['COMPLETED', 'CANCELED'],
  COMPLETED:     ['PAID', 'CANCELED'],
  PAID:          [],
  CANCELED:      [],
};

// ── Roles ───────────────────────────────────────────────────────────────────
/**
 * Platform-level role on the User. PLATFORM_ADMIN can bypass tenant boundaries
 * (audited). CUSTOMER is the default and means "no platform privileges; scope
 * comes from TenantMembership".
 */
export const PlatformRole = z.enum(['CUSTOMER', 'PLATFORM_ADMIN']);
export type PlatformRole = z.infer<typeof PlatformRole>;

/**
 * Per-tenant role attached via TenantMembership.
 * - CUSTOMER: end-user of that tenant's services
 * - STAFF:    can view quotes assigned to them, cannot change pricing
 * - OWNER:    full operational control of the tenant plus billing & user management
 */
export const TenantRole = z.enum(['CUSTOMER', 'STAFF', 'OWNER']);
export type TenantRole = z.infer<typeof TenantRole>;

export const TENANT_ROLE_RANK: Record<TenantRole, number> = {
  CUSTOMER: 0,
  STAFF:    10,
  OWNER:    20,
};

export function tenantRoleAtLeast(actual: TenantRole, required: TenantRole): boolean {
  return TENANT_ROLE_RANK[actual] >= TENANT_ROLE_RANK[required];
}

// ── Tenant lifecycle ────────────────────────────────────────────────────────
export const TenantStatus = z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED', 'TRIAL']);
export type TenantStatus = z.infer<typeof TenantStatus>;

export const PlanTier = z.enum(['STARTER', 'GROWTH', 'PRO', 'ENTERPRISE']);
export type PlanTier = z.infer<typeof PlanTier>;

// ── Property kind ───────────────────────────────────────────────────────────
export const PropertyKind = z.enum(['RESIDENTIAL', 'COMMERCIAL']);
export type PropertyKind = z.infer<typeof PropertyKind>;

// ── Service category ────────────────────────────────────────────────────────
export const ServiceCategory = z.enum(['RESIDENTIAL', 'COMMERCIAL', 'BOTH']);
export type ServiceCategory = z.infer<typeof ServiceCategory>;

// ── Pricing mode ────────────────────────────────────────────────────────────
export const PricingMode = z.enum(['FIXED', 'QUOTE_REQUIRED', 'COMPUTED']);
export type PricingMode = z.infer<typeof PricingMode>;

// ── Message channel ─────────────────────────────────────────────────────────
export const MessageChannel = z.enum(['EMAIL', 'SMS', 'PUSH', 'IN_APP']);
export type MessageChannel = z.infer<typeof MessageChannel>;

// ── Message template kinds ──────────────────────────────────────────────────
export const MessageKind = z.enum([
  'verify_email',
  'password_reset',
  'quote_received_customer',
  'quote_received_internal',
  'estimate_sent_customer',
  'quote_followup_no_response',
  'quote_accepted_internal',
  'job_scheduled_customer',
  'job_reminder_customer',
  'job_started_customer',
  'job_completed_customer',
  'invoice_sent_customer',
  'payment_received_customer',
  'review_request_customer',
  'referral_request_customer',
]);
export type MessageKind = z.infer<typeof MessageKind>;

// ── Email delivery status ───────────────────────────────────────────────────
export const EmailStatus = z.enum([
  'QUEUED',
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
]);
export type EmailStatus = z.infer<typeof EmailStatus>;

// ── Token purposes ──────────────────────────────────────────────────────────
export const TokenPurpose = z.enum([
  'EMAIL_VERIFY',
  'PASSWORD_RESET',
  'TENANT_INVITE',
  'MAGIC_LOGIN',
]);
export type TokenPurpose = z.infer<typeof TokenPurpose>;

// ── Line item kinds ─────────────────────────────────────────────────────────
/**
 * Generic line item kinds across trades. A `Service` declares which kinds it
 * uses via its `capabilities`. A `QuoteLineItem.kind` is one of these strings;
 * `payload` is a kind-specific JSONB blob whose shape is defined in
 * `config.ts` as `LineItemPayloadSchema`.
 */
export const LineItemKind = z.enum([
  'window',         // window cleaning, glass repair
  'fixture',        // plumbing fixtures, light fixtures
  'unit',           // HVAC units, appliances
  'sqft_zone',      // landscaping, painting, flooring
  'room',           // cleaning, painting
  'linear_ft',      // gutters, fence, trim
  'pest_treatment', // pest control
  'misc',
]);
export type LineItemKind = z.infer<typeof LineItemKind>;
