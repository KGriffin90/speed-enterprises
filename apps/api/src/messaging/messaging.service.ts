import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { BrandingSchema, type Branding } from '@speed-enterprises/shared';
import { DEFAULT_TEMPLATES } from './default-templates';
import { renderMessage } from './email-renderer';
import { SmsService } from './sms.service';

interface SendOpts {
  tenantId?: string;
  kind: string;
  channel?: 'EMAIL' | 'SMS';
  toEmail: string;
  vars: Record<string, string | number | undefined | null>;
  quoteRequestId?: string;
}

/**
 * Tenant-aware messaging dispatcher. Loads the template (tenant override or
 * platform default), renders it with branding, and sends via Resend (if
 * configured) or SMTP (Mailhog) in dev. Every send is logged.
 *
 * In dev (no RESEND_API_KEY), messages are printed to console and logged
 * with status SENT but no real network call is made — keeps onboarding zero-friction.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  /** Cached id of the synthetic `_platform` tenant used for platform-level email logs. */
  private platformTenantIdCache: string | null = null;

  constructor(
    private catalog: CatalogPrismaService,
    private tenantDb: TenantDatabaseService,
    private sms: SmsService,
  ) {}

  /**
   * Pick the database client for a message: the tenant's own DB for tenant
   * messages, or the catalog for platform-level emails (verify/reset) that have
   * no tenant. Tenant-scoped config/templates/logs must never read the wrong DB.
   */
  private async clientForMessage(tenantId?: string): Promise<PrismaClient> {
    return tenantId ? this.tenantDb.clientFor(tenantId) : this.catalog;
  }

  /**
   * Resolve the id of the synthetic `_platform` tenant that collects
   * platform-level email logs (verify/reset). Prefer the PLATFORM_TENANT_ID env
   * override; otherwise look it up by slug in the catalog and cache it. Returns
   * null if no platform tenant has been seeded (caller then skips the log).
   *
   * This avoids the prior bug where the literal string '_platform' was used as a
   * tenant *id*, which never matches the seeded cuid and violated the EmailLog
   * foreign key.
   */
  private async resolvePlatformTenantId(): Promise<string | null> {
    if (process.env.PLATFORM_TENANT_ID) return process.env.PLATFORM_TENANT_ID;
    if (this.platformTenantIdCache) return this.platformTenantIdCache;
    const tenant = await this.catalog.tenant.findUnique({
      where: { slug: PLATFORM_FALLBACK_TENANT_SLUG },
      select: { id: true },
    });
    this.platformTenantIdCache = tenant?.id ?? null;
    return this.platformTenantIdCache;
  }

  // ── Platform-level (no tenant) sends ─────────────────────────────────────
  async sendVerification(toEmail: string, otp: string, secret: string): Promise<void> {
    const verifyUrl = `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/auth/verify?token=${encodeURIComponent(secret)}`;
    await this.send({
      kind: 'verify_email',
      toEmail,
      vars: {
        platformName: process.env.PLATFORM_NAME ?? 'Speed Enterprises',
        otp,
        verifyUrl,
      },
    });
  }

  async sendPasswordReset(toEmail: string, secret: string): Promise<void> {
    const resetUrl = `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/auth/reset-password?token=${encodeURIComponent(secret)}`;
    await this.send({
      kind: 'password_reset',
      toEmail,
      vars: {
        platformName: process.env.PLATFORM_NAME ?? 'Speed Enterprises',
        resetUrl,
      },
    });
  }

  // ── Tenant-scoped send ───────────────────────────────────────────────────
  async sendForTenant(opts: SendOpts & { tenantId: string }): Promise<void> {
    await this.send(opts);
  }

  /**
   * Send a raw HTML email that bypasses the template system.
   * Used for appointment confirmations and proposals which generate their own HTML.
   */
  async sendRawEmail(opts: {
    tenantId: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const db = await this.clientForMessage(opts.tenantId);
    const cfg = await db.tenantConfig.findUnique({
      where: { tenantId: opts.tenantId },
      select: { contact: true, businessName: true },
    });
    const contact    = (cfg?.contact as any) ?? {};
    const fromEmail  = contact.emailFromAddress ?? (process.env.PLATFORM_DEFAULT_FROM ?? 'noreply@example.com');
    const fromName   = contact.emailFromName   ?? cfg?.businessName ?? 'Speed Enterprises';
    const fromHeader = `${fromName} <${fromEmail}>`;

    // Enqueue onto the outbox; the dispatch worker sends it via Postmark
    // (suppression-checked + retried). Nothing is sent inline here.
    await db.emailLog.create({
      data: {
        tenantId:   opts.tenantId,
        kind:       'raw',
        channel:    'EMAIL',
        toEmail:    opts.to,
        fromEmail:  fromHeader,
        subject:    opts.subject,
        templateId: 'raw',
        payload:    {},
        bodyHtml:   opts.html,
        bodyText:   htmlToText(opts.html),
        status:     'QUEUED',
        nextAttemptAt: new Date(),
      },
    });
  }

  // ── Internal send ────────────────────────────────────────────────────────
  private async send(opts: SendOpts): Promise<void> {
    const tenantId = opts.tenantId;
    const db = await this.clientForMessage(tenantId);

    // Load tenant config (for branding + from address) if scoped
    let branding: Branding | null = null;
    let businessName = process.env.PLATFORM_NAME ?? 'Speed Enterprises';
    let fromEmail = process.env.PLATFORM_DEFAULT_FROM ?? 'noreply@example.com';
    let fromName: string | undefined;
    let smsFromNumber: string | null = null;
    let notificationEmails: string[] = [];

    if (tenantId) {
      const cfg = await db.tenantConfig.findUnique({
        where: { tenantId },
        select: { branding: true, contact: true, businessName: true },
      });
      if (cfg) {
        businessName = cfg.businessName;
        const parsedBranding = BrandingSchema.safeParse(cfg.branding);
        if (parsedBranding.success) branding = parsedBranding.data;
        const contact = cfg.contact as any;
        if (contact?.emailFromAddress) fromEmail = contact.emailFromAddress;
        if (contact?.emailFromName)    fromName  = contact.emailFromName;
        if (contact?.smsNumber)        smsFromNumber = contact.smsNumber;
        if (Array.isArray(contact?.notificationEmails)) notificationEmails = contact.notificationEmails;
      }
    }

    // Resolve template: tenant override -> platform default
    let template: { subject?: string; body: string } | null = null;
    if (tenantId) {
      const row = await db.automationTemplate.findUnique({
        where: { tenantId_kind_channel: { tenantId, kind: opts.kind, channel: opts.channel ?? 'EMAIL' } },
      });
      if (row?.enabled) template = { subject: row.subject ?? undefined, body: row.body };
    }
    if (!template) {
      const fallback = DEFAULT_TEMPLATES.find(
        (t) => t.kind === opts.kind && t.channel === (opts.channel ?? 'EMAIL'),
      );
      if (!fallback) {
        this.logger.warn(`No template for ${opts.kind}/${opts.channel ?? 'EMAIL'} — skipping send`);
        return;
      }
      template = { subject: fallback.subject, body: fallback.body };
    }

    const rendered = renderMessage({
      body: template.body,
      subject: template.subject,
      vars: { businessName, ...opts.vars },
      branding,
      businessName,
      platformName: process.env.PLATFORM_NAME ?? 'Speed Enterprises',
    });

    const fromHeader = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
    const recipient = opts.kind.endsWith('_internal') && notificationEmails.length
      ? notificationEmails.join(',')
      : opts.toEmail;
    const channel = opts.channel ?? 'EMAIL';

    // Platform-level emails (no tenant) log against the synthetic `_platform`
    // tenant — resolved by slug at runtime so the EmailLog FK is satisfied.
    const logTenantId = tenantId ?? (await this.resolvePlatformTenantId());
    if (!logTenantId) {
      this.logger.warn('No platform fallback tenant found (seed the `_platform` tenant); sending without EmailLog.');
    }

    // Persist to the outbox. The EmailLog row IS the queue: EMAIL rows are left
    // QUEUED for the dispatch worker (Postmark + suppression + retries). SMS is
    // sent inline below since Postmark is email-only.
    const log = logTenantId
      ? await db.emailLog.create({
          data: {
            tenantId:  logTenantId,
            kind:      opts.kind,
            channel,
            toEmail:   recipient,
            fromEmail: fromHeader,
            subject:   rendered.subject,
            templateId: opts.kind,
            payload:   redactedPayload(opts.vars) as any,  // Prisma typed JSONB as InputJsonValue; Record<string, unknown> is safe at runtime
            bodyHtml:  rendered.html,
            bodyText:  rendered.text,
            status:    'QUEUED',
            nextAttemptAt: channel === 'SMS' ? null : new Date(),
            quoteRequestId: opts.quoteRequestId ?? null,
          },
        }).catch((err: unknown) => {
          this.logger.error('EmailLog create failed.', err);
          return null;
        })
      : null;

    if (channel === 'SMS') {
      try {
        const result = await this.sms.send({ fromNumber: smsFromNumber, toNumber: recipient, body: rendered.text });
        if (log) {
          await db.emailLog.update({
            where: { id: log.id },
            data: result.ok
              ? { status: 'SENT', providerMessageId: result.providerMessageId }
              : { status: 'FAILED', errorMessage: result.errorMessage ?? 'SMS failed' },
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err ?? 'unknown');
        this.logger.error(`SMS send failed for ${opts.kind}`, err);
        if (log) await db.emailLog.update({ where: { id: log.id }, data: { status: 'FAILED', errorMessage: message } });
      }
      return;
    }

    // EMAIL: nothing is sent inline — EmailDispatchService drains the QUEUED row.
    if (!log) {
      this.logger.warn(`Email "${opts.kind}" to ${recipient} could not be queued (no EmailLog row); it will not be sent.`);
    }
  }
}

/** Minimal HTML→text fallback for raw emails that ship without a text part. */
function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function redactedPayload(vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (['otp', 'token', 'password', 'secret'].some((s) => k.toLowerCase().includes(s))) {
      out[k] = '[redacted]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Platform-level emails (verify_email, password_reset) need an EmailLog row, but
 * EmailLog is tenant-scoped. We attach them to a synthetic tenant seeded with
 * slug='_platform'. Its id is resolved at runtime by slug (see
 * resolvePlatformTenantId) — never hard-coded, because the seeded row has a
 * generated cuid id, not the literal slug. PLATFORM_TENANT_ID can override.
 */
const PLATFORM_FALLBACK_TENANT_SLUG = '_platform';
