import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../database/tenant-db.provider';
import {
  ServiceSchema, CreateServiceDto, UpdateServiceDto,
} from '@speed-enterprises/shared';

/**
 * Tenant business service. Injects the request-scoped TENANT_DB client, which
 * is automatically bound to the active tenant's database (its own physical DB
 * in db-per-tenant mode, the shared DB in pool mode). The explicit `tenantId`
 * filters below are retained as belt-and-suspenders: required for isolation in
 * pool mode, redundant-but-harmless once each tenant has a dedicated database.
 */
@Injectable()
export class ServicesService {
  constructor(@Inject(TENANT_DB) private prisma: PrismaClient) {}

  list(tenantId: string) {
    return this.prisma.service.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async listPublic(tenantId: string) {
    return this.prisma.service.findMany({
      where: { tenantId, active: true, visibleOnPublicSite: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async getById(tenantId: string, id: string) {
    const s = await this.prisma.service.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!s) throw new NotFoundException();
    return s;
  }

  async getBySlug(tenantId: string, slug: string) {
    const s = await this.prisma.service.findUnique({ where: { tenantId_slug: { tenantId, slug } } });
    if (!s || s.deletedAt) throw new NotFoundException();
    return s;
  }

  async create(tenantId: string, dto: CreateServiceDto) {
    // Validate the *content* shape (questions, pricingRules) via ServiceSchema (minus id).
    ServiceSchema.omit({ id: true }).parse(dto);
    return this.prisma.service.create({
      data: {
        tenantId,
        slug:             dto.slug,
        name:             dto.name,
        category:         dto.category,
        description:      dto.description,
        iconKey:          dto.iconKey ?? null,
        active:           dto.active ?? true,
        visibleOnPublicSite: dto.visibleOnPublicSite ?? true,
        basePriceCents:   dto.basePriceCents ?? 0,
        pricingMode:      dto.pricingMode,
        questions:        dto.questions as any,
        pricingRules:     dto.pricingRules as any,
        lineItemKinds:    dto.lineItemKinds ?? [],
        capabilities:     dto.capabilities ?? [],
        estimatedDurationMinutes: dto.estimatedDurationMinutes ?? null,
        requiresOnsiteEstimate:   dto.requiresOnsiteEstimate ?? false,
        sortOrder:        dto.sortOrder ?? 0,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateServiceDto) {
    await this.getById(tenantId, id);
    return this.prisma.service.update({
      where: { id },
      data: {
        ...dto,
        questions:    dto.questions as any,
        pricingRules: dto.pricingRules as any,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.getById(tenantId, id);
    await this.prisma.service.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
  }
}
