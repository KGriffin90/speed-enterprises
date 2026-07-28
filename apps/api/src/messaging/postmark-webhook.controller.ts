import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { SuppressionService } from './suppression.service';

/** One Postmark webhook event (bounce, complaint, delivery, open, click). */
interface PostmarkEvent {
  RecordType?: string;
  Type?: string;
  Email?: string;
  MessageID?: string;
  Inactive?: boolean;
  Description?: string;
  Details?: string;
  Metadata?: Record<string, string>;
}

/**
 * Receives Postmark message-event webhooks. Postmark secures webhooks with HTTP
 * Basic Auth embedded in the configured URL (no HMAC signature), so we require
 * the same credentials here (POSTMARK_WEBHOOK_USER/PASS). Each event is
 * correlated to its EmailLog row via the Metadata we stamp at send time, the
 * row's status is updated, and hard bounces / complaints are suppressed.
 *
 * Mounted at POST /api/webhooks/postmark — no tenant/auth guards (external call).
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class PostmarkWebhookController {
  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly suppression: SuppressionService,
  ) {}

  @Post('postmark')
  async handle(
    @Headers('authorization') auth: string | undefined,
    @Body() body: PostmarkEvent | PostmarkEvent[],
  ): Promise<{ ok: true }> {
    if (!this.authorized(auth)) throw new UnauthorizedException();
    const events = Array.isArray(body) ? body : [body];
    for (const ev of events) {
      try { await this.process(ev); } catch { /* never 500 a webhook into a retry storm; logged elsewhere */ }
    }
    return { ok: true };
  }

  private authorized(authHeader?: string): boolean {
    const user = process.env.POSTMARK_WEBHOOK_USER ?? '';
    const pass = process.env.POSTMARK_WEBHOOK_PASS ?? '';
    if (!user && !pass) return true; // dev: unprotected when no creds configured
    if (!authHeader?.startsWith('Basic ')) return false;
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    return safeEqual(decoded, `${user}:${pass}`);
  }

  private async process(ev: PostmarkEvent): Promise<void> {
    const recordType = ev.RecordType;
    let status: string | null = null;
    let suppressReason: string | null = null;
    switch (recordType) {
      case 'Bounce':
        status = 'BOUNCED';
        if (ev.Type === 'HardBounce' || ev.Inactive === true) suppressReason = 'hard_bounce';
        break;
      case 'SpamComplaint':
        status = 'COMPLAINED';
        suppressReason = 'spam_complaint';
        break;
      case 'Delivery': status = 'DELIVERED'; break;
      case 'Open':     status = 'OPENED';    break;
      case 'Click':    status = 'CLICKED';   break;
      default: return; // ignore unhandled record types
    }

    const detail = ev.Description ?? ev.Details ?? null;
    await this.updateLog(ev.Metadata, ev.MessageID, status, suppressReason ? detail : null);

    if (suppressReason && ev.Email) {
      await this.suppression.suppress(ev.Email, suppressReason, 'postmark_webhook', detail ?? undefined);
    }
  }

  /** Update the EmailLog row in its DB — tenant DB (via Metadata.tenantId) first, then catalog. */
  private async updateLog(
    metadata: Record<string, string> | undefined,
    messageId: string | undefined,
    status: string,
    errorMessage: string | null,
  ): Promise<void> {
    const emailLogId = metadata?.emailLogId;
    const tenantId = metadata?.tenantId;
    const where = emailLogId ? { id: emailLogId } : messageId ? { providerMessageId: messageId } : null;
    if (!where) return;

    const clients: PrismaClient[] = [];
    if (tenantId) {
      try { clients.push(await this.tenantDb.clientFor(tenantId)); } catch { /* fall through to catalog */ }
    }
    clients.push(this.catalog);

    for (const client of clients) {
      const res = await client.emailLog
        .updateMany({ where, data: { status: status as any, ...(errorMessage ? { errorMessage } : {}) } })
        .catch(() => ({ count: 0 }));
      if (res.count > 0) return;
    }
  }
}

/** Constant-time string comparison to avoid timing attacks on the webhook creds. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
