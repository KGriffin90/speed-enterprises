import { z } from 'zod';
import { QuoteStatus, PropertyKind, LineItemKind } from '../enums';
import { ServiceAddressSchema } from '../config';

export const CreateQuoteDto = z.object({
  serviceId:    z.string(),
  propertyKind: PropertyKind,
  /** Service address. If absent, uses the customer profile address for that tenant. */
  address:      ServiceAddressSchema.optional(),
  /** Map of questionId → answer value. Validated server-side against Service.questions. */
  answers:      z.record(z.string(), z.unknown()).default({}),
  customerNotes: z.string().max(2000).optional(),
  preferredAt:   z.string().optional(),  // free-text date OR ISO
});
export type CreateQuoteDto = z.infer<typeof CreateQuoteDto>;

export const UpdateQuoteDto = CreateQuoteDto.partial();
export type UpdateQuoteDto = z.infer<typeof UpdateQuoteDto>;

export const AddLineItemDto = z.object({
  kind:           LineItemKind,
  payload:        z.record(z.string(), z.unknown()),  // shape validated per-kind on server
  quantity:       z.number().int().positive().default(1),
  unitPriceCents: z.number().int().nonnegative().optional(),
  source:         z.enum(['camera', 'manual', 'ai_estimate', 'import']).default('manual'),
  confidence:     z.number().min(0).max(1).optional(),
  isEstimated:    z.boolean().optional(),
  label:          z.string().max(120).optional(),
});
export type AddLineItemDto = z.infer<typeof AddLineItemDto>;

export const UpdateLineItemDto = AddLineItemDto.partial();
export type UpdateLineItemDto = z.infer<typeof UpdateLineItemDto>;

export const ChangeStatusDto = z.object({
  status: QuoteStatus,
  note:   z.string().max(500).optional(),
});
export type ChangeStatusDto = z.infer<typeof ChangeStatusDto>;

export const SendEstimateDto = z.object({
  amountCents: z.number().int().nonnegative(),
  message:     z.string().max(4000),
  validForDays: z.number().int().positive().optional(),
});
export type SendEstimateDto = z.infer<typeof SendEstimateDto>;

// ── Public (anonymous) quote-request submission ────────────────────────────
export const PublicQuoteRequestDto = z.object({
  serviceSlug: z.string(),
  propertyKind: PropertyKind,
  contact: z.object({
    email:    z.string().email(),
    phone:    z.string().min(5),
    fullName: z.string().min(1),
  }),
  address: ServiceAddressSchema,
  answers: z.record(z.string(), z.unknown()).default({}),
  customerNotes: z.string().max(2000).optional(),
});
export type PublicQuoteRequestDto = z.infer<typeof PublicQuoteRequestDto>;
