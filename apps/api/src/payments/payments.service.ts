import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe'; // default import used only for `new Stripe(...)` — namespace types avoided
import { TENANT_DB } from '../database/tenant-db.provider';

function makeStripe(key: string) {
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' });
}
type StripeClient = ReturnType<typeof makeStripe>;

@Injectable()
export class PaymentsService {
  private _stripe: StripeClient | null = null;

  private get stripe(): StripeClient {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new BadRequestException('Stripe is not configured — add STRIPE_SECRET_KEY to your .env');
    return (this._stripe ??= makeStripe(key));
  }

  // Single-plane service (only reads/writes TenantConfig.payments in the tenant DB).
  constructor(@Inject(TENANT_DB) private prisma: PrismaClient) {}

  /** Start or resume a Stripe Connect onboarding session for a tenant. */
  async startOnboarding(tenantId: string, returnUrl: string, refreshUrl: string) {
    const cfg = await this.prisma.tenantConfig.findUniqueOrThrow({ where: { tenantId } });
    const payments = cfg.payments as any;

    let accountId: string = payments?.stripeAccountId;
    if (!accountId) {
      const account = await this.stripe.accounts.create({
        type: 'express',
        metadata: { tenantId },
      });
      accountId = account.id;
      await this.prisma.tenantConfig.update({
        where: { tenantId },
        data: { payments: { ...(payments ?? {}), stripeAccountId: accountId } as any },
      });
    }

    const link = await this.stripe.accountLinks.create({
      account:     accountId,
      return_url:  returnUrl,
      refresh_url: refreshUrl,
      type: 'account_onboarding',
    });

    return { url: link.url, accountId };
  }

  async getAccountStatus(tenantId: string) {
    const cfg = await this.prisma.tenantConfig.findUniqueOrThrow({ where: { tenantId } });
    const payments = cfg.payments as any;
    const accountId: string | undefined = payments?.stripeAccountId;

    if (!accountId) return { connected: false, accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false };

    const account = await this.stripe.accounts.retrieve(accountId);
    return {
      connected:        true,
      accountId,
      chargesEnabled:   account.charges_enabled,
      payoutsEnabled:   account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      businessName:     account.business_profile?.name ?? null,
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    // Let TypeScript infer the event type from constructEvent's return type
    // to avoid the StripeConstructor namespace limitation.
    let event: ReturnType<typeof this.stripe.webhooks.constructEvent>;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    if (event.type === 'account.updated') {
      const account = event.data.object as { metadata?: Record<string, string>; charges_enabled?: boolean; payouts_enabled?: boolean; details_submitted?: boolean };
      const tenantId = account.metadata?.tenantId;
      if (tenantId) {
        const cfg = await this.prisma.tenantConfig.findUnique({ where: { tenantId } });
        if (cfg) {
          await this.prisma.tenantConfig.update({
            where: { tenantId },
            data: {
              payments: {
                ...(cfg.payments as any),
                chargesEnabled:   account.charges_enabled,
                payoutsEnabled:   account.payouts_enabled,
                detailsSubmitted: account.details_submitted,
              } as any,
            },
          });
        }
      }
    }

    return { received: true };
  }
}
