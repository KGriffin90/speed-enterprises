import { z } from 'zod';
import { TenantRole, PlatformRole } from '../enums';

export const RegisterDto = z.object({
  tenantSlug: z.string().optional(),  // when registering as a customer of a specific tenant
  email:      z.string().email(),
  password:   z.string().min(8).max(72),
  fullName:   z.string().min(1).max(120),
  phone:      z.string().min(5).max(30),
  address: z.object({
    line1:      z.string().min(1),
    city:       z.string().min(1),
    state:      z.string().length(2),
    postalCode: z.string().min(3).max(12),
  }).optional(),

  // ── Legal consent (captured at account creation) ──────────────────────────
  // Hard gate: registration is rejected unless the user affirmatively accepts.
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms of Service and Privacy Policy to create an account.' }),
  }),
  // Version strings of the documents the user accepted (for the audit trail).
  acceptedTermsVersion:   z.string().max(40).optional(),
  acceptedPrivacyVersion: z.string().max(40).optional(),
  // Optional, separate opt-in for marketing communications.
  marketingConsent:       z.boolean().optional().default(false),
});
export type RegisterDto = z.infer<typeof RegisterDto>;

export const LoginDto = z.object({
  tenantSlug: z.string().optional(),
  email:      z.string().email(),
  password:   z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const VerifyEmailDto = z.object({
  email: z.string().email(),
  otp:   z.string().length(6).optional(),
  token: z.string().min(20).optional(),
}).refine(d => !!d.otp || !!d.token, { message: 'otp or token required' });
export type VerifyEmailDto = z.infer<typeof VerifyEmailDto>;

export const ForgotPasswordDto = z.object({ email: z.string().email() });
export type ForgotPasswordDto = z.infer<typeof ForgotPasswordDto>;

export const ResetPasswordDto = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(72),
});
export type ResetPasswordDto = z.infer<typeof ResetPasswordDto>;

export const RefreshDto = z.object({ refreshToken: z.string().min(20) });
export type RefreshDto = z.infer<typeof RefreshDto>;

export const SwitchTenantDto = z.object({ tenantSlug: z.string() });
export type SwitchTenantDto = z.infer<typeof SwitchTenantDto>;

export const SessionResponseDto = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id:           z.string(),
    email:        z.string().email(),
    fullName:     z.string().nullable(),
    platformRole: PlatformRole,
  }),
  tenant: z.object({
    id:        z.string(),
    slug:      z.string(),
    name:      z.string(),
    role:      TenantRole,
  }).nullable(),
  memberships: z.array(z.object({
    tenantId:   z.string(),
    tenantSlug: z.string(),
    tenantName: z.string(),
    role:       TenantRole,
  })),
});
export type SessionResponseDto = z.infer<typeof SessionResponseDto>;
