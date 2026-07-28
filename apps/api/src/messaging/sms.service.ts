import { Injectable, Logger } from '@nestjs/common';

interface SmsSendArgs {
  fromNumber: string | null;
  toNumber:   string;
  body:       string;
}

interface SmsResult {
  providerMessageId: string | null;
  ok: boolean;
  errorMessage?: string;
}

/**
 * Tenant-aware SMS dispatcher. When TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
 * + (TWILIO_MESSAGING_SERVICE_SID or a per-tenant fromNumber) are set, sends
 * via Twilio's REST API directly (no SDK dependency).
 *
 * Without those creds it console-prints the SMS in dev — keeps the rest of
 * the messaging pipeline working end-to-end without Twilio set up.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  private hasTwilio(): boolean {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  }

  async send(args: SmsSendArgs): Promise<SmsResult> {
    if (!this.hasTwilio()) {
      // eslint-disable-next-line no-console
      console.log('\n=== SMS (DEV) ===');
      console.log('TO:  ', args.toNumber);
      console.log('FROM:', args.fromNumber ?? '(unconfigured)');
      console.log('---');
      console.log(args.body);
      console.log('===\n');
      return { providerMessageId: null, ok: true };
    }

    const sid       = process.env.TWILIO_ACCOUNT_SID!;
    const token     = process.env.TWILIO_AUTH_TOKEN!;
    const msSid     = process.env.TWILIO_MESSAGING_SERVICE_SID;

    const params = new URLSearchParams();
    params.set('To',   args.toNumber);
    params.set('Body', args.body);
    if (msSid) {
      params.set('MessagingServiceSid', msSid);
    } else if (args.fromNumber) {
      params.set('From', args.fromNumber);
    } else {
      return { providerMessageId: null, ok: false, errorMessage: 'No From number or MessagingServiceSid configured' };
    }

    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.logger.error(`Twilio ${res.status}: ${data?.message ?? 'send failed'}`);
        return { providerMessageId: null, ok: false, errorMessage: data?.message ?? `Twilio ${res.status}` };
      }
      return { providerMessageId: data?.sid ?? null, ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Twilio fetch failed: ${message}`);
      return { providerMessageId: null, ok: false, errorMessage: message };
    }
  }
}
