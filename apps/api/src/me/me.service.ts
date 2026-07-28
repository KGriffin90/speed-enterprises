import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../database/tenant-db.provider';
import { CatalogPrismaService } from '../database/catalog-prisma.service';

/**
 * Identity (User, RefreshToken, TenantMembership) lives in the CATALOG database;
 * business rows (CustomerProfile) live in the active tenant's database. We never
 * join across the two — each read targets the right client.
 */
@Injectable()
export class MeService {
  constructor(
    @Inject(TENANT_DB) private prisma: PrismaClient, // active tenant DB (business)
    private catalog: CatalogPrismaService,           // control-plane (identity)
  ) {}

  async getProfile(userId: string, tenantId: string) {
    // Identity from catalog, business profile from the tenant DB.
    const [user, membership] = await this.catalog.$transaction([
      this.catalog.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, platformRole: true, emailVerifiedAt: true, createdAt: true },
      }),
      this.catalog.tenantMembership.findUnique({
        where: { userId_tenantId: { userId, tenantId } },
      }),
    ]);
    const profile = await this.prisma.customerProfile.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });
    return { user, profile, membership };
  }

  async updateProfile(userId: string, tenantId: string, dto: {
    fullName?: string; phone?: string;
    addressLine?: string; city?: string; state?: string; postalCode?: string;
    marketingConsent?: boolean;
  }) {
    const profile = await this.prisma.customerProfile.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });
    if (!profile) throw new BadRequestException('No profile for this tenant');
    return this.prisma.customerProfile.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: {
        ...(dto.fullName    !== undefined ? { fullName:    dto.fullName    } : {}),
        ...(dto.phone       !== undefined ? { phone:       dto.phone       } : {}),
        ...(dto.addressLine !== undefined ? { addressLine: dto.addressLine } : {}),
        ...(dto.city        !== undefined ? { city:        dto.city        } : {}),
        ...(dto.state       !== undefined ? { state:       dto.state.toUpperCase() } : {}),
        ...(dto.postalCode  !== undefined ? { postalCode:  dto.postalCode  } : {}),
        ...(dto.marketingConsent !== undefined ? { marketingConsent: dto.marketingConsent } : {}),
      },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (newPassword.length < 8) throw new BadRequestException('Password too short');
    // All identity — stays entirely in the catalog.
    const user = await this.catalog.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash) throw new BadRequestException('This account uses SSO');
    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.catalog.$transaction([
      this.catalog.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.catalog.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /**
   * Self-serve account deletion. Soft-delete (schema convention: deletedAt),
   * deactivate every tenant membership, and revoke all refresh tokens. Login
   * already rejects users with deletedAt set, and token revocation kills any
   * live sessions on next refresh. Identity rows are retained for audit/quote
   * history integrity per the platform's soft-delete convention.
   */
  async deleteAccount(userId: string) {
    await this.catalog.$transaction([
      this.catalog.user.update({
        where: { id: userId },
        data: { deletedAt: new Date() },
      }),
      this.catalog.tenantMembership.updateMany({
        where: { userId },
        data: { active: false },
      }),
      this.catalog.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }
}
