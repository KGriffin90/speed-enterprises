import { z } from 'zod';
import {
  BrandingSchema, ContactSchema, SchedulingSchema,
  AutomationSchema, AISchema, PaymentsSchema, FeaturesSchema, Slug,
} from '../config';
import { Industry, PlanTier, TenantRole, TenantStatus } from '../enums';

export const CreateTenantDto = z.object({
  slug:         Slug,
  businessName: z.string().min(1).max(120),
  legalName:    z.string().min(1).max(160),
  industry:     Industry,
  planTier:     PlanTier.default('STARTER'),
  /** Email of the first tenant OWNER. They will receive an invite. */
  ownerEmail:   z.string().email(),
  ownerName:    z.string().min(1).max(120),
  /** Service templates (by id) to clone for this tenant. */
  serviceTemplateIds: z.array(z.string()).default([]),
  branding:     BrandingSchema.partial().optional(),
  contact:      ContactSchema.partial().optional(),
  scheduling:   SchedulingSchema.partial().optional(),
  features:     FeaturesSchema.partial().optional(),
});
export type CreateTenantDto = z.infer<typeof CreateTenantDto>;

export const UpdateTenantConfigDto = z.object({
  branding:   BrandingSchema.partial().optional(),
  contact:    ContactSchema.partial().optional(),
  scheduling: SchedulingSchema.partial().optional(),
  automation: AutomationSchema.partial().optional(),
  ai:         AISchema.partial().optional(),
  payments:   PaymentsSchema.partial().optional(),
  features:   FeaturesSchema.partial().optional(),
});
export type UpdateTenantConfigDto = z.infer<typeof UpdateTenantConfigDto>;

export const InviteMemberDto = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  role: TenantRole,
});
export type InviteMemberDto = z.infer<typeof InviteMemberDto>;

export const SetTenantStatusDto = z.object({ status: TenantStatus });
export type SetTenantStatusDto = z.infer<typeof SetTenantStatusDto>;
