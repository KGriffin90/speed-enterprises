import {
  Injectable, UnauthorizedException, ConflictException, BadRequestException,
  NotFoundException, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { MessagingService } from '../messaging/messaging.service';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import {
  RegisterDto, LoginDto, VerifyEmailDto, ForgotPasswordDto, ResetPasswordDto,
  RefreshDto, SwitchTenantDto, SessionResponseDto,
} from '@speed-enterprises/shared';
import { TokenPurpose, PlatformRole, TenantRole } from '@prisma/client';

// Email-verification 6-digit code (and its magic-link token) is valid for
// 15 minutes after it's sent; verifyEmail rejects anything past expiresAt.
const OTP_TTL_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: CatalogPrismaService,   // identity: User, RefreshToken, VerificationToken, TenantMembership, Tenant
    private tenantDb: TenantDatabaseService, // for CustomerProfile, which is tenant-DB business data
    private jwt: JwtService,
    private messaging: MessagingService,
  ) {}

  // ── Register a customer for a tenant ─────────────────────────────────────
  async register(
    dto: RegisterDto,
    ctx: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<{ userId: string; tenantId: string | null }> {
    // Defense in depth: the DTO already requires acceptTerms === true, but never
    // create an account without recorded consent.
    if (dto.acceptTerms !== true) {
      throw new BadRequestException('You must accept the Terms of Service and Privacy Policy.');
    }
    if (!dto.tenantSlug) throw new BadRequestException('tenantSlug required');
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
    if (!tenant) throw new NotFoundException('Unknown tenant');
    if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIAL') {
      throw new BadRequestException('Tenant unavailable');
    }

    const email = dto.email.toLowerCase();
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    // Find or create the platform User
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      // Existing platform user — they're adding a new tenant membership.
      // Don't change their password.
      const existing = await this.prisma.tenantMembership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
      });
      if (existing) throw new ConflictException('Already registered with this business');
    } else {
      user = await this.prisma.user.create({
        data: { email, passwordHash, platformRole: PlatformRole.CUSTOMER },
      });
    }

    // Membership is identity (catalog); the customer profile is business data in
    // the tenant's own database — two databases, so two writes rather than one
    // cross-DB transaction.
    await this.prisma.tenantMembership.create({
      data: {
        userId:    user.id,
        tenantId:  tenant.id,
        role:      TenantRole.CUSTOMER,
        fullName:  dto.fullName,
        acceptedAt: new Date(),
      },
    });
    const tenantClient = await this.tenantDb.clientFor(tenant.id);
    await tenantClient.customerProfile.create({
      data: {
        userId:      user.id,
        tenantId:    tenant.id,
        fullName:    dto.fullName,
        phone:       dto.phone,
        addressLine: dto.address?.line1 ?? null,
        city:        dto.address?.city ?? null,
        state:       dto.address?.state?.toUpperCase() ?? null,
        postalCode:  dto.address?.postalCode ?? null,
        marketingConsent: dto.marketingConsent ?? false,
      },
    });

    // Record the legal acceptance audit trail (catalog/identity DB). Best-effort:
    // a logging failure must not block account creation.
    await this.recordLegalAcceptance(user.id, dto, ctx).catch(() => undefined);

    if (!user.emailVerifiedAt) await this.issueEmailVerification(user.id, user.email);
    return { userId: user.id, tenantId: tenant.id };
  }

  /** Write one immutable LegalAcceptance row per accepted document. */
  private async recordLegalAcceptance(
    userId: string,
    dto: RegisterDto,
    ctx: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const rows = [
      { document: 'terms',   version: dto.acceptedTermsVersion   ?? 'unspecified' },
      { document: 'privacy', version: dto.acceptedPrivacyVersion ?? 'unspecified' },
      // The app and web both surface the EULA in the same consent; record it too.
      { document: 'eula',    version: dto.acceptedTermsVersion   ?? 'unspecified' },
    ];
    await this.prisma.legalAcceptance.createMany({
      data: rows.map(r => ({
        userId,
        document:  r.document,
        version:   r.version,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      })),
    });
  }

  // ── Verify email (OTP or token) ──────────────────────────────────────────
  async verifyEmail(dto: VerifyEmailDto): Promise<SessionResponseDto> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException();
    if (user.emailVerifiedAt) return this.issueSession(user.id, null);

    const tokenRow = await this.prisma.verificationToken.findFirst({
      where: { userId: user.id, purpose: TokenPurpose.EMAIL_VERIFY, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!tokenRow) throw new BadRequestException('No active verification — request a new code');

    let ok = false;
    if (dto.otp) ok = !!tokenRow.otpCode && await argon2.verify(tokenRow.otpCode, dto.otp);
    else if (dto.token) ok = tokenRow.tokenHash === sha256(dto.token);
    if (!ok) throw new UnauthorizedException('Invalid code');

    await this.prisma.$transaction([
      this.prisma.verificationToken.update({ where: { id: tokenRow.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
    ]);
    return this.issueSession(user.id, null);
  }

  async resendVerification(emailRaw: string): Promise<void> {
    const email = emailRaw.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) return;
    await this.issueEmailVerification(user.id, user.email);
  }

  // ── Login ────────────────────────────────────────────────────────────────
  async login(dto: LoginDto): Promise<SessionResponseDto> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Invalid credentials');
    if (!user.passwordHash) throw new UnauthorizedException('This account uses SSO');
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (!user.emailVerifiedAt) throw new UnauthorizedException('Email not verified');

    let tenantId: string | null = null;
    if (dto.tenantSlug) {
      const t = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
      if (!t) throw new NotFoundException('Unknown tenant');
      const m = await this.prisma.tenantMembership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId: t.id } },
      });
      if (!m) throw new UnauthorizedException('No access to this business');
      tenantId = t.id;
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueSession(user.id, tenantId);
  }

  // ── Switch active tenant (issues a new session bound to the new tenant) ─
  async switchTenant(userId: string, dto: SwitchTenantDto): Promise<SessionResponseDto> {
    const t = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
    if (!t) throw new NotFoundException('Unknown tenant');
    const m = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId: t.id } },
    });
    if (!m) throw new UnauthorizedException('No access to this business');
    return this.issueSession(userId, t.id);
  }

  // ── Password reset ───────────────────────────────────────────────────────
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) return;  // do not reveal
    const secret = crypto.randomBytes(32).toString('hex');
    await this.prisma.verificationToken.create({
      data: {
        userId:    user.id,
        purpose:   TokenPurpose.PASSWORD_RESET,
        tokenHash: sha256(secret),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    await this.messaging.sendPasswordReset(user.email, secret);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = sha256(dto.token);
    const tokenRow = await this.prisma.verificationToken.findFirst({
      where: { tokenHash, purpose: TokenPurpose.PASSWORD_RESET, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!tokenRow || !tokenRow.userId) throw new UnauthorizedException('Invalid or expired token');
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: tokenRow.userId }, data: { passwordHash } }),
      this.prisma.verificationToken.update({ where: { id: tokenRow.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: tokenRow.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // ── Refresh ──────────────────────────────────────────────────────────────
  async refresh(dto: RefreshDto): Promise<SessionResponseDto> {
    const tokenHash = sha256(dto.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issueSession(stored.userId, stored.activeTenantId);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = sha256(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── Issue a session (access + refresh + memberships payload) ────────────
  private async issueSession(userId: string, tenantId: string | null): Promise<SessionResponseDto> {
    const [user, memberships] = await this.prisma.$transaction([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.tenantMembership.findMany({
        where: { userId, active: true },
        include: { tenant: { include: { config: { select: { businessName: true } } } } },
      }),
    ]);

    // Resolve active tenant membership (if any). The explicit `any` here is
    // only needed before `prisma generate` runs; the generated client will
    // give us a precise type and these annotations remain valid.
    let activeMembership: any = tenantId
      ? memberships.find((m: any) => m.tenantId === tenantId) ?? null
      : null;
    if (!activeMembership && memberships.length === 1) activeMembership = memberships[0]!;

    const profile = activeMembership
      ? await (await this.tenantDb.clientFor(activeMembership.tenantId)).customerProfile.findUnique({
          where: { userId_tenantId: { userId: user.id, tenantId: activeMembership.tenantId } },
        })
      : null;

    const accessToken = await this.jwt.signAsync({
      sub:           user.id,
      email:         user.email,
      platformRole:  user.platformRole,
      tenantId:      activeMembership?.tenantId,
      tenantRole:    activeMembership?.role,
    });

    const refreshSecret = crypto.randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId:         user.id,
        tokenHash:      sha256(refreshSecret),
        activeTenantId: activeMembership?.tenantId ?? null,
        expiresAt:      new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken: refreshSecret,
      user: {
        id:           user.id,
        email:        user.email,
        fullName:     profile?.fullName ?? activeMembership?.fullName ?? null,
        platformRole: user.platformRole,
      },
      tenant: activeMembership
        ? {
            id:   activeMembership.tenantId,
            slug: activeMembership.tenant.slug,
            name: activeMembership.tenant.config?.businessName ?? activeMembership.tenant.slug,
            role: activeMembership.role,
          }
        : null,
      memberships: memberships.map((m: any) => ({
        tenantId:   m.tenantId,
        tenantSlug: m.tenant.slug,
        tenantName: m.tenant.config?.businessName ?? m.tenant.slug,
        role:       m.role,
      })),
    };
  }

  // ── Email-verification token issuer ──────────────────────────────────────
  private async issueEmailVerification(userId: string, email: string): Promise<void> {
    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const secret = crypto.randomBytes(24).toString('hex');

    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log('\n==============================');
      console.log('DEV EMAIL VERIFICATION');
      console.log('EMAIL:', email);
      console.log('OTP:', otp);
      console.log('==============================\n');
    }

    await this.prisma.verificationToken.create({
      data: {
        userId,
        purpose:   TokenPurpose.EMAIL_VERIFY,
        otpCode:   await argon2.hash(otp, { type: argon2.argon2id }),
        tokenHash: sha256(secret),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await this.messaging.sendVerification(email, otp, secret);
  }
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
