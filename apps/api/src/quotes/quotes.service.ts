import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../database/tenant-db.provider';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { computePricing } from './pricing-engine';
import { validateAnswers } from './question-validator';
import {
  CreateQuoteDto, UpdateQuoteDto, ChangeStatusDto, SendEstimateDto,
  PublicQuoteRequestDto, AddLineItemDto, UpdateLineItemDto,
  LEGAL_STATUS_TRANSITIONS, getLineItemPayloadSchema, type LineItemKind,
} from '@speed-enterprises/shared';
import { QuoteStatus, AuditAction } from '@prisma/client';

/**
 * Quotes and everything hanging off them (line items, status history, audit
 * log, customer profiles) are TENANT DB rows. The only cross-database reference
 * is QuoteRequest.userId → User, which lives in the CATALOG. We never `include`
 * the user across that boundary; instead we batch-load emails from the catalog
 * and the customer profile from the tenant DB, then attach a `user`-shaped
 * object so callers/UI see the same structure as before.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(TENANT_DB) private prisma: PrismaClient, // active tenant DB
    private catalog: CatalogPrismaService,           // control-plane (User)
    private messaging: MessagingService,
  ) {}

  /**
   * Attach `user: { email, customerProfiles: [{ fullName, phone }] } | null` to
   * quote rows — replacing the old cross-DB Prisma include. Email comes from the
   * catalog; the profile from this tenant's DB.
   */
  private async attachCustomer<T extends { userId: string | null }>(
    tenantId: string,
    quotes: T[],
  ): Promise<Array<T & { user: { email: string; customerProfiles: Array<{ fullName: string | null; phone: string | null }> } | null }>> {
    const userIds = Array.from(
      new Set(quotes.map((q) => q.userId).filter((id): id is string => typeof id === 'string')),
    );
    const [users, profiles] = await Promise.all([
      userIds.length
        ? this.catalog.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
        : Promise.resolve([] as Array<{ id: string; email: string }>),
      userIds.length
        ? this.prisma.customerProfile.findMany({
            where: { tenantId, userId: { in: userIds } },
            select: { userId: true, fullName: true, phone: true },
          })
        : Promise.resolve([] as Array<{ userId: string; fullName: string | null; phone: string | null }>),
    ]);
    const emailByUser = new Map(users.map((u) => [u.id, u.email]));
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
    return quotes.map((q) => ({
      ...q,
      user: q.userId
        ? {
            email: emailByUser.get(q.userId) ?? '',
            customerProfiles: profileByUser.has(q.userId)
              ? [{ fullName: profileByUser.get(q.userId)!.fullName, phone: profileByUser.get(q.userId)!.phone }]
              : [],
          }
        : null,
    }));
  }

  /** Email for a quote's owner (catalog lookup), or undefined for guests. */
  private async ownerEmail(userId: string | null): Promise<string | undefined> {
    if (!userId) return undefined;
    const u = await this.catalog.user.findUnique({ where: { id: userId }, select: { email: true } });
    return u?.email;
  }

  // ── Customer endpoints ───────────────────────────────────────────────────

  async createForUser(tenantId: string, userId: string, dto: CreateQuoteDto) {
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, tenantId, active: true, deletedAt: null },
    });
    if (!service) throw new NotFoundException('Service not available');

    const questions = service.questions as any;
    const normalized = validateAnswers(questions, dto.answers);

    const profile = await this.prisma.customerProfile.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });
    if (!profile && !dto.address) {
      throw new BadRequestException('Address required (no saved profile on file)');
    }

    const addr = dto.address ?? {
      line1:      profile!.addressLine!,
      city:       profile!.city!,
      state:      profile!.state!,
      postalCode: profile!.postalCode!,
    };

    const quote = await this.prisma.quoteRequest.create({
      data: {
        tenantId,
        userId,
        serviceId:    service.id,
        propertyKind: dto.propertyKind,
        addressLine:  addr.line1,
        city:         addr.city,
        state:        addr.state.toUpperCase(),
        postalCode:   addr.postalCode,
        answers:      normalized as any,
        customerNotes: dto.customerNotes ?? null,
        preferredAtNote: dto.preferredAt ?? null,
        preferredAt:  this.tryParseDate(dto.preferredAt),
        source:       'web',
      },
    });

    // Persist the address the customer entered back onto their profile so it's
    // remembered for next time and reflected anywhere the profile is shown.
    // updateMany is a no-op if no profile row exists (authed users always have one).
    if (dto.address) {
      await this.prisma.customerProfile.updateMany({
        where: { userId, tenantId },
        data: {
          addressLine: addr.line1,
          city:        addr.city,
          state:       addr.state.toUpperCase(),
          postalCode:  addr.postalCode,
        },
      });
    }

    await this.recomputePricing(tenantId, quote.id);
    return this.getById(tenantId, quote.id);
  }

  async createPublic(tenantId: string, dto: PublicQuoteRequestDto) {
    const service = await this.prisma.service.findFirst({
      where: { tenantId, slug: dto.serviceSlug, active: true, visibleOnPublicSite: true, deletedAt: null },
    });
    if (!service) throw new NotFoundException('Service not available');

    const questions = service.questions as any;
    const normalized = validateAnswers(questions, dto.answers);

    const quote = await this.prisma.quoteRequest.create({
      data: {
        tenantId,
        serviceId:    service.id,
        propertyKind: dto.propertyKind,
        guestEmail:   dto.contact.email.toLowerCase(),
        guestName:    dto.contact.fullName,
        guestPhone:   dto.contact.phone,
        addressLine:  dto.address.line1,
        city:         dto.address.city,
        state:        dto.address.state.toUpperCase(),
        postalCode:   dto.address.postalCode,
        answers:      normalized as any,
        customerNotes: dto.customerNotes ?? null,
        source:       'public_form',
      },
    });

    await this.recomputePricing(tenantId, quote.id);
    await this.notifyOnCreate(tenantId, quote.id);
    return this.getById(tenantId, quote.id);
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateQuoteDto) {
    const quote = await this.assertOwner(tenantId, userId, id);
    if (quote.status !== QuoteStatus.NEW) throw new BadRequestException('Cannot edit a quote that has been reviewed');

    let answers = quote.answers as Record<string, unknown>;
    if (dto.answers) {
      const service = await this.prisma.service.findFirstOrThrow({
        where: { id: quote.serviceId, tenantId },
      });
      answers = validateAnswers(service.questions as any, dto.answers);
    }

    await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        ...(dto.address ? {
          addressLine: dto.address.line1, city: dto.address.city,
          state: dto.address.state.toUpperCase(), postalCode: dto.address.postalCode,
        } : {}),
        ...(dto.propertyKind ? { propertyKind: dto.propertyKind } : {}),
        ...(dto.customerNotes !== undefined ? { customerNotes: dto.customerNotes } : {}),
        ...(dto.preferredAt !== undefined ? {
          preferredAtNote: dto.preferredAt,
          preferredAt: this.tryParseDate(dto.preferredAt),
        } : {}),
        ...(dto.answers ? { answers: answers as any } : {}),
      },
    });

    await this.recomputePricing(tenantId, id);
    return this.getById(tenantId, id);
  }

  async submit(tenantId: string, userId: string, id: string) {
    const quote = await this.assertOwner(tenantId, userId, id);
    if (quote.status !== QuoteStatus.NEW) throw new BadRequestException('Quote already submitted');
    await this.notifyOnCreate(tenantId, id);
    return this.getById(tenantId, id);
  }

  /**
   * Customer approves the estimate. This does NOT advance the status — the quote
   * stays ESTIMATE_SENT until a time is confirmed (which moves it to SCHEDULED
   * via the appointments flow). `acceptedAt` records the approval so the UI can
   * reveal the time-approval step (approve the owner's proposed window, or pick
   * a conflict-free alternative).
   */
  async acceptEstimate(tenantId: string, userId: string, id: string, note?: string) {
    const quote = await this.assertOwner(tenantId, userId, id);
    if (quote.status !== QuoteStatus.ESTIMATE_SENT) {
      throw new BadRequestException(`Cannot accept from status ${quote.status}`);
    }
    if (quote.estimateValidUntil && quote.estimateValidUntil < new Date()) {
      throw new BadRequestException('This estimate has expired — please request a new one');
    }
    await this.prisma.$transaction([
      this.prisma.quoteRequest.update({
        where: { id },
        data: { acceptedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          tenantId, actorUserId: userId, action: AuditAction.QUOTE_STATUS_CHANGED,
          entityType: 'QuoteRequest', entityId: id,
          metadata: { event: 'ESTIMATE_APPROVED', byCustomer: true } as any,
        },
      }),
    ]);
    await this.notifyEstimateAccepted(tenantId, id, note ?? null);
    return this.getById(tenantId, id);
  }

  /**
   * Customer declines an estimate. Records a status change to CANCELED with
   * a reason note — tenant admin can re-open by changing status back.
   */
  async declineEstimate(tenantId: string, userId: string, id: string, reason: string) {
    const quote = await this.assertOwner(tenantId, userId, id);
    if (quote.status !== QuoteStatus.ESTIMATE_SENT) {
      throw new BadRequestException(`Cannot decline from status ${quote.status}`);
    }
    await this.prisma.$transaction([
      this.prisma.quoteRequest.update({
        where: { id },
        data: { status: QuoteStatus.CANCELED },
      }),
      this.prisma.quoteStatusHistory.create({
        data: {
          tenantId, quoteRequestId: id,
          fromStatus: QuoteStatus.ESTIMATE_SENT, toStatus: QuoteStatus.CANCELED,
          changedById: userId, note: `Declined by customer: ${reason}`,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          tenantId, actorUserId: userId, action: AuditAction.QUOTE_STATUS_CHANGED,
          entityType: 'QuoteRequest', entityId: id,
          metadata: { from: 'ESTIMATE_SENT', to: 'CANCELED', byCustomer: true, reason } as any,
        },
      }),
    ]);
    return this.getById(tenantId, id);
  }

  async listMine(tenantId: string, userId: string) {
    const user = await this.catalog.user.findUnique({ where: { id: userId }, select: { email: true } });
    return this.prisma.quoteRequest.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { userId },
          ...(user ? [{ guestEmail: user.email.toLowerCase() }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { lineItems: true, service: { select: { name: true, slug: true } } },
    });
  }

  async getById(tenantId: string, id: string) {
    const q = await this.prisma.quoteRequest.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        lineItems: true,
        images: true,
        service: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!q) throw new NotFoundException();
    const [withUser] = await this.attachCustomer(tenantId, [q]);
    return withUser;
  }

  /**
   * Customer-facing single-quote read with object-level authorization.
   *
   * A quote is the caller's if it's linked to their user id OR was submitted
   * anonymously under their email (the same rule `listMine` uses to surface
   * claimed guest quotes). Anything else 404s — we don't reveal that another
   * customer's quote exists, and unlike `assertOwner` this never mutates
   * (no silent claiming on a read). Admin/staff use the unrestricted `getById`.
   */
  async getByIdForUser(tenantId: string, userId: string, id: string) {
    await this.assertOwnedByUser(tenantId, userId, id);
    return this.getById(tenantId, id);
  }

  /**
   * Read-only object-level authorization gate. Throws NotFound unless the quote
   * belongs to the caller — linked to their user id, or submitted anonymously
   * under their email (same rule as `listMine`). Never mutates (unlike the
   * action-path `assertOwner`, which claims unowned quotes). Reused by any
   * customer endpoint that reads quote-scoped data (e.g. its appointments).
   */
  async assertOwnedByUser(tenantId: string, userId: string, id: string): Promise<void> {
    const user = await this.catalog.user.findUnique({ where: { id: userId }, select: { email: true } });
    const owned = await this.prisma.quoteRequest.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        OR: [
          { userId },
          ...(user ? [{ guestEmail: user.email.toLowerCase() }] : []),
        ],
      },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException();
  }

  async remove(tenantId: string, userId: string, id: string) {
    await this.assertOwner(tenantId, userId, id);
    await this.prisma.quoteRequest.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Owner-only delete of any quote in the tenant. Soft-deletes via `deletedAt`
   * (every quote read filters `deletedAt: null`), so it disappears from the web
   * and mobile lists at once while its history and line items stay intact.
   */
  async adminRemove(tenantId: string, actorUserId: string, id: string) {
    const quote = await this.prisma.quoteRequest.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!quote) throw new NotFoundException();
    await this.prisma.$transaction([
      this.prisma.quoteRequest.update({ where: { id }, data: { deletedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: {
          tenantId, actorUserId, action: AuditAction.QUOTE_DELETED,
          entityType: 'QuoteRequest', entityId: id, metadata: { status: quote.status } as any,
        },
      }),
    ]);
    return { deleted: true };
  }

  // ── Line items ───────────────────────────────────────────────────────────
  async addLineItem(tenantId: string, userId: string | null, quoteId: string, dto: AddLineItemDto) {
    if (userId) await this.assertOwner(tenantId, userId, quoteId);
    const schema = getLineItemPayloadSchema(dto.kind as LineItemKind);
    const payload = schema.parse(dto.payload);
    const item = await this.prisma.quoteLineItem.create({
      data: {
        tenantId,
        quoteRequestId: quoteId,
        kind:           dto.kind,
        payload:        payload as any,
        quantity:       dto.quantity ?? 1,
        unitPriceCents: dto.unitPriceCents ?? null,
        source:         dto.source ?? 'manual',
        confidence:     dto.confidence ?? null,
        isEstimated:    dto.isEstimated ?? (dto.source === 'camera'),
        label:          dto.label ?? null,
      },
    });
    await this.recomputePricing(tenantId, quoteId);
    return item;
  }

  async updateLineItem(tenantId: string, userId: string | null, quoteId: string, itemId: string, dto: UpdateLineItemDto) {
    if (userId) await this.assertOwner(tenantId, userId, quoteId);
    const item = await this.prisma.quoteLineItem.findFirst({ where: { id: itemId, tenantId, quoteRequestId: quoteId } });
    if (!item) throw new NotFoundException();
    if (dto.payload && dto.kind) {
      const schema = getLineItemPayloadSchema(dto.kind as LineItemKind);
      dto.payload = schema.parse(dto.payload);
    }
    const updated = await this.prisma.quoteLineItem.update({
      where: { id: itemId },
      data: { ...dto, payload: dto.payload as any },
    });
    await this.recomputePricing(tenantId, quoteId);
    return updated;
  }

  async removeLineItem(tenantId: string, userId: string | null, quoteId: string, itemId: string) {
    if (userId) await this.assertOwner(tenantId, userId, quoteId);
    const item = await this.prisma.quoteLineItem.findFirst({ where: { id: itemId, tenantId, quoteRequestId: quoteId } });
    if (!item) throw new NotFoundException();
    await this.prisma.quoteLineItem.delete({ where: { id: itemId } });
    await this.recomputePricing(tenantId, quoteId);
  }

  // ── Admin endpoints ──────────────────────────────────────────────────────
  async listAdmin(tenantId: string, filter: { status?: string; serviceId?: string; q?: string }) {
    const rows = await this.prisma.quoteRequest.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filter.status    ? { status: filter.status as QuoteStatus } : {}),
        ...(filter.serviceId ? { serviceId: filter.serviceId } : {}),
        ...(filter.q ? {
          OR: [
            { guestName:  { contains: filter.q, mode: 'insensitive' } },
            { guestEmail: { contains: filter.q, mode: 'insensitive' } },
            { addressLine:{ contains: filter.q, mode: 'insensitive' } },
            { city:       { contains: filter.q, mode: 'insensitive' } },
          ],
        } : {}),
      },
      include: {
        lineItems: true,
        service: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return this.attachCustomer(tenantId, rows);
  }

  /** Admin-only field updates (internal notes). Tenant-scoped; 404 if not found. */
  async adminUpdate(tenantId: string, id: string, dto: {
    internalNotes?: string | null;
    jobComplexity?: 'SIMPLE' | 'COMPLEX' | null;
    complexityNote?: string | null;
  }) {
    const quote = await this.prisma.quoteRequest.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!quote) throw new NotFoundException();
    await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        ...(dto.internalNotes  !== undefined ? { internalNotes:  dto.internalNotes }  : {}),
        ...(dto.jobComplexity  !== undefined ? { jobComplexity:  dto.jobComplexity }  : {}),
        ...(dto.complexityNote !== undefined ? { complexityNote: dto.complexityNote } : {}),
      },
    });
    return this.getById(tenantId, id);
  }

  /**
   * Flip a NEW quote to REVIEWING the first time the owner opens it (called from
   * the admin "get one quote" path). No-op for any other status.
   */
  async markReviewing(tenantId: string, adminUserId: string, id: string) {
    const quote = await this.prisma.quoteRequest.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!quote || quote.status !== QuoteStatus.NEW) return;
    await this.prisma.$transaction([
      this.prisma.quoteRequest.update({
        where: { id },
        data: { status: QuoteStatus.REVIEWING },
      }),
      this.prisma.quoteStatusHistory.create({
        data: {
          tenantId, quoteRequestId: id,
          fromStatus: QuoteStatus.NEW, toStatus: QuoteStatus.REVIEWING,
          changedById: adminUserId, note: 'Opened by owner',
        },
      }),
      this.prisma.auditLog.create({
        data: {
          tenantId, actorUserId: adminUserId, action: AuditAction.QUOTE_STATUS_CHANGED,
          entityType: 'QuoteRequest', entityId: id,
          metadata: { from: 'NEW', to: 'REVIEWING', auto: true } as any,
        },
      }),
    ]);
  }

  async changeStatus(tenantId: string, adminUserId: string, id: string, dto: ChangeStatusDto) {
    const quote = await this.prisma.quoteRequest.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!quote) throw new NotFoundException();
    const allowed = LEGAL_STATUS_TRANSITIONS[quote.status as keyof typeof LEGAL_STATUS_TRANSITIONS] ?? [];
    if (!allowed.includes(dto.status as any)) {
      throw new BadRequestException(`Illegal transition: ${quote.status} → ${dto.status}`);
    }
    await this.prisma.$transaction([
      this.prisma.quoteRequest.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
          ...(dto.status === 'IN_PROGRESS' ? { startedAt: new Date() } : {}),
          ...(dto.status === 'PAID'     ? { paidAt:    new Date() } : {}),
        },
      }),
      this.prisma.quoteStatusHistory.create({
        data: {
          tenantId, quoteRequestId: id, fromStatus: quote.status,
          toStatus: dto.status, changedById: adminUserId, note: dto.note ?? null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          tenantId, actorUserId: adminUserId, action: AuditAction.QUOTE_STATUS_CHANGED,
          entityType: 'QuoteRequest', entityId: id,
          metadata: { from: quote.status, to: dto.status, note: dto.note ?? null },
        },
      }),
    ]);

    // Optional notifications on key transitions
    if (dto.status === 'SCHEDULED')   await this.notifyJobScheduled(tenantId, id);
    if (dto.status === 'COMPLETED')   await this.notifyJobCompleted(tenantId, id);

    return this.getById(tenantId, id);
  }

  async sendEstimate(tenantId: string, adminUserId: string, id: string, dto: SendEstimateDto) {
    const quote = await this.prisma.quoteRequest.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!quote) throw new NotFoundException();
    const validUntil = dto.validForDays
      ? new Date(Date.now() + dto.validForDays * 24 * 3600 * 1000)
      : null;

    await this.prisma.$transaction([
      this.prisma.quoteRequest.update({
        where: { id },
        data: {
          estimateAmountCents: dto.amountCents,
          estimateSentAt:      new Date(),
          estimateValidUntil:  validUntil,
          status:              QuoteStatus.ESTIMATE_SENT,
        },
      }),
      this.prisma.quoteStatusHistory.create({
        data: {
          tenantId, quoteRequestId: id, fromStatus: quote.status,
          toStatus: QuoteStatus.ESTIMATE_SENT, changedById: adminUserId, note: dto.message,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          tenantId, actorUserId: adminUserId, action: AuditAction.ESTIMATE_SENT,
          entityType: 'QuoteRequest', entityId: id,
          metadata: { amountCents: dto.amountCents },
        },
      }),
    ]);

    await this.notifyEstimateSent(tenantId, id, dto.amountCents, dto.message);
    return this.getById(tenantId, id);
  }

  // ── Internal: pricing recompute ──────────────────────────────────────────
  private async recomputePricing(tenantId: string, quoteId: string) {
    const quote = await this.prisma.quoteRequest.findFirst({
      where: { id: quoteId, tenantId },
      include: { service: true, lineItems: true },
    });
    if (!quote || quote.service.pricingMode === 'QUOTE_REQUIRED') return;

    const result = computePricing({
      basePriceCents: quote.service.basePriceCents,
      questions:      quote.service.questions as any,
      answers:        quote.answers as Record<string, unknown>,
      rules:          quote.service.pricingRules as any,
    });

    // Add line-item totals as separate steps (post-rule)
    let total = result.totalCents;
    const breakdown = [...result.breakdown];
    for (const li of quote.lineItems) {
      const delta = (li.unitPriceCents ?? 0) * li.quantity;
      if (delta === 0) continue;
      total += delta;
      breakdown.push({
        ruleId: null,
        label: li.label ?? `${li.kind} × ${li.quantity}`,
        deltaCents: delta,
        runningCents: total,
      });
    }

    await this.prisma.quoteRequest.update({
      where: { id: quoteId },
      data: {
        pricingBreakdown: { steps: breakdown, totalCents: total, appliedRuleIds: result.appliedRuleIds } as any,
        // For FIXED-pricing services we surface the computed total as the estimate amount immediately.
        ...(quote.service.pricingMode === 'FIXED' || quote.service.pricingMode === 'COMPUTED'
          ? { estimateAmountCents: total }
          : {}),
      },
    });
  }

  // ── Internal: notifications ──────────────────────────────────────────────
  private async notifyOnCreate(tenantId: string, quoteId: string) {
    const q = await this.prisma.quoteRequest.findFirstOrThrow({
      where: { id: quoteId, tenantId },
      include: { service: true },
    });
    const recipientEmail = q.guestEmail ?? (await this.ownerEmail(q.userId));
    const firstName = (q.guestName ?? '').split(' ')[0] ?? '';
    const address = `${q.addressLine}, ${q.city} ${q.state} ${q.postalCode}`;

    if (recipientEmail) {
      await this.messaging.sendForTenant({
        tenantId,
        kind: 'quote_received_customer',
        toEmail: recipientEmail,
        quoteRequestId: q.id,
        vars: {
          customerFirstName: firstName,
          customerEmail: recipientEmail,
          serviceName: q.service.name,
          address,
          quoteId: q.id,
        },
      });
    }

    await this.messaging.sendForTenant({
      tenantId,
      kind: 'quote_received_internal',
      toEmail: 'internal',  // resolved by tenant config notificationEmails
      quoteRequestId: q.id,
      vars: {
        customerName:  q.guestName ?? '',
        customerEmail: recipientEmail ?? '',
        customerPhone: q.guestPhone ?? '',
        serviceName:   q.service.name,
        address,
        customerNotes: q.customerNotes ?? '—',
        quoteUrl: `${process.env.WEB_ORIGIN}/admin/quotes/${q.id}`,
      },
    });
  }

  private async notifyEstimateSent(tenantId: string, quoteId: string, amountCents: number, message: string) {
    const q = await this.prisma.quoteRequest.findFirstOrThrow({
      where: { id: quoteId, tenantId },
      include: { service: true, user: true },
    });
    const to = q.guestEmail ?? q.user?.email;
    if (!to) return;
    const fmt = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    await this.messaging.sendForTenant({
      tenantId,
      kind: 'estimate_sent_customer',
      toEmail: to,
      quoteRequestId: q.id,
      vars: {
        customerFirstName: (q.guestName ?? '').split(' ')[0] ?? '',
        serviceName: q.service.name,
        quoteAmount: fmt(amountCents),
        estimateMessage: message,
        quoteUrl: `${process.env.WEB_ORIGIN}/quote/${q.id}`,
        quoteId: q.id,
      },
    });
  }

  private async notifyEstimateAccepted(tenantId: string, quoteId: string, note: string | null) {
    const q = await this.prisma.quoteRequest.findFirstOrThrow({
      where: { id: quoteId, tenantId }, include: { service: true },
    });
    const customerEmail = q.guestEmail ?? (await this.ownerEmail(q.userId)) ?? '';
    await this.messaging.sendForTenant({
      tenantId,
      kind: 'quote_accepted_internal',
      toEmail: 'internal',
      quoteRequestId: q.id,
      vars: {
        customerName:  q.guestName ?? customerEmail ?? '',
        customerEmail,
        serviceName:   q.service.name,
        address: `${q.addressLine}, ${q.city} ${q.state} ${q.postalCode}`,
        quoteAmount:   q.estimateAmountCents != null
          ? (q.estimateAmountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
          : '',
        customerNote:  note ?? '',
        quoteUrl: `${process.env.WEB_ORIGIN}/admin/quotes/${q.id}`,
      },
    });
  }

  private async notifyJobScheduled(tenantId: string, quoteId: string) {
    const q = await this.prisma.quoteRequest.findFirstOrThrow({
      where: { id: quoteId, tenantId }, include: { service: true },
    });
    const to = q.guestEmail ?? (await this.ownerEmail(q.userId));
    if (!to || !q.scheduledAt) return;
    await this.messaging.sendForTenant({
      tenantId,
      kind: 'job_scheduled_customer',
      toEmail: to,
      quoteRequestId: q.id,
      vars: {
        customerFirstName: (q.guestName ?? '').split(' ')[0] ?? '',
        scheduledAt: q.scheduledAt.toISOString(),
        address: `${q.addressLine}, ${q.city} ${q.state} ${q.postalCode}`,
        serviceName: q.service.name,
      },
    });
  }

  private async notifyJobCompleted(tenantId: string, quoteId: string) {
    const q = await this.prisma.quoteRequest.findFirstOrThrow({
      where: { id: quoteId, tenantId }, include: { service: true },
    });
    const to = q.guestEmail ?? (await this.ownerEmail(q.userId));
    if (!to) return;
    await this.messaging.sendForTenant({
      tenantId,
      kind: 'job_completed_customer',
      toEmail: to,
      quoteRequestId: q.id,
      vars: {
        customerFirstName: (q.guestName ?? '').split(' ')[0] ?? '',
        serviceName: q.service.name,
        address: `${q.addressLine}, ${q.city} ${q.state} ${q.postalCode}`,
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private async assertOwner(tenantId: string, userId: string, id: string) {
    const q = await this.prisma.quoteRequest.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!q) throw new NotFoundException();

    if (q.userId === null) {
      // Quote was submitted anonymously via the public form (userId never set).
      // The customer has since registered/signed in and is acting on the estimate
      // they received by email. Link the quote to their account now so all
      // future ownership checks pass normally.
      await this.prisma.quoteRequest.update({ where: { id }, data: { userId } });
      return { ...q, userId };
    }

    if (q.userId !== userId) throw new ForbiddenException();
    return q;
  }

  private tryParseDate(s?: string | null): Date | null {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
