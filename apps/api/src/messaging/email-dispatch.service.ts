import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { PostmarkService } from './postmark.service';
import { SuppressionService } from './suppression.service';

const BATCH_PER_DB = 25;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 60_000;   // 1 min, doubled per attempt
const MAX_BACKOFF_MS = 60 * 60_000; // capped at 1 h

type QueuedEmail = {
  id: string;
  tenantId: string;
  kind: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  bodyHtml: string | null;
  bodyText: string | null;
  attempts: number;
};

/**
 * Outbox drainer. Every cron tick it claims QUEUED EMAIL rows from the catalog
 * DB (platform mail) and each active tenant DB, then sends them via Postmark.
 *
 * Idempotency: a row is claimed with an atomic QUEUED→PROCESSING update; only the
 * worker that wins the update (count === 1) sends it, so retries and overlapping
 * instances can't double-send.
 *
 * Retry/dead-letter: transient failures are requeued with exponential backoff up
 * to MAX_ATTEMPTS, after which the row is marked FAILED (dead-letter, inspectable
 * in EmailLog). Permanent failures (4xx / suppressed) fail immediately.
 */
@Injectable()
export class EmailDispatchService {
  private readonly logger = new Logger(EmailDispatchService.name);
  private running = false;

  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly postmark: PostmarkService,
    private readonly suppression: SuppressionService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'email-outbox-drain' })
  async drain(): Promise<void> {
    if (this.running) return;       // never overlap a slow run
    this.running = true;
    try {
      // Catalog (platform-level mail: verify/reset) + every active tenant DB.
      await this.drainDb(this.catalog);
      const tenants = await this.catalog.tenant.findMany({
        where: { deletedAt: null, dbStatus: 'READY' },
        select: { id: true },
      });
      for (const t of tenants) {
        try {
          const client = await this.tenantDb.clientFor(t.id);
          if (client !== (this.catalog as unknown as PrismaClient)) await this.drainDb(client);
        } catch (err) {
          this.logger.warn(`Outbox drain skipped tenant ${t.id}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async drainDb(client: PrismaClient): Promise<void> {
    const rows = (await client.emailLog.findMany({
      where: {
        status: 'QUEUED',
        channel: 'EMAIL',
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_PER_DB,
      select: {
        id: true, tenantId: true, kind: true, toEmail: true, fromEmail: true,
        subject: true, bodyHtml: true, bodyText: true, attempts: true,
      },
    })) as QueuedEmail[];

    for (const row of rows) {
      // Atomic claim — only one worker proceeds.
      const claim = await client.emailLog.updateMany({
        where: { id: row.id, status: 'QUEUED' },
        data: { status: 'PROCESSING' },
      });
      if (claim.count !== 1) continue;
      await this.sendOne(client, row);
    }
  }

  private async sendOne(client: PrismaClient, row: QueuedEmail): Promise<void> {
    // Suppression gate — never send to a bounced/complained address.
    if (await this.suppression.isSuppressed(row.toEmail)) {
      await client.emailLog.update({
        where: { id: row.id },
        data: { status: 'FAILED', lastError: 'suppressed', errorMessage: 'Recipient is suppressed' },
      });
      return;
    }

    // Dev fallback: no Postmark token → render to the console, mark SENT.
    if (!this.postmark.configured) {
      // eslint-disable-next-line no-console
      console.log('\n=== EMAIL (DEV — no Postmark token) ===');
      console.log('TO:     ', row.toEmail);
      console.log('FROM:   ', row.fromEmail);
      console.log('SUBJECT:', row.subject);
      console.log('---');
      console.log(row.bodyText ?? '(no text body)');
      console.log('===\n');
      await client.emailLog.update({ where: { id: row.id }, data: { status: 'SENT' } });
      return;
    }

    const result = await this.postmark.send({
      from:    row.fromEmail,
      to:      row.toEmail,
      subject: row.subject,
      html:    row.bodyHtml ?? '',
      text:    row.bodyText ?? '',
      // Correlate webhook events back to this exact row + tenant DB.
      metadata: { emailLogId: row.id, tenantId: row.tenantId },
    });

    if (result.ok) {
      await client.emailLog.update({
        where: { id: row.id },
        data: { status: 'SENT', providerMessageId: result.providerMessageId ?? null, lastError: null },
      });
      return;
    }

    const attempts = row.attempts + 1;
    const canRetry = result.retryable && attempts < MAX_ATTEMPTS;
    if (canRetry) {
      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
      await client.emailLog.update({
        where: { id: row.id },
        data: {
          status: 'QUEUED',
          attempts,
          nextAttemptAt: new Date(Date.now() + backoff),
          lastError: result.errorMessage ?? 'transient error',
        },
      });
    } else {
      await client.emailLog.update({
        where: { id: row.id },
        data: { status: 'FAILED', attempts, lastError: result.errorMessage ?? 'send failed', errorMessage: result.errorMessage ?? null },
      });
      // Postmark 406 = inactive recipient → suppress defensively.
      if (result.errorCode === 406) {
        await this.suppression.suppress(row.toEmail, 'hard_bounce', 'postmark_inactive', result.errorMessage).catch(() => undefined);
      }
    }
  }
}
