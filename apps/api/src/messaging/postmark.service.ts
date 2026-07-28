import { Injectable, Logger } from '@nestjs/common';
import { ServerClient } from 'postmark';

export interface PostmarkSendInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  messageStream?: string;
  /** Stamped into Postmark Metadata so webhooks can correlate back to our EmailLog. */
  metadata?: Record<string, string>;
}

export interface PostmarkSendResult {
  ok: boolean;
  providerMessageId?: string;
  errorCode?: number;     // Postmark API error code (e.g. 406 = inactive recipient)
  errorMessage?: string;
  /** True for transient failures the worker should retry; false for permanent ones. */
  retryable: boolean;
}

/**
 * Thin transport around Postmark's official `ServerClient` (npm `postmark`).
 * The ONLY place that calls Postmark. Token comes from POSTMARK_SERVER_TOKEN —
 * when unset, `configured` is false and the dispatcher uses its dev console
 * fallback instead of attempting a real send.
 */
@Injectable()
export class PostmarkService {
  private readonly logger = new Logger(PostmarkService.name);
  private client: ServerClient | null = null;

  constructor() {
    const token = process.env.POSTMARK_SERVER_TOKEN;
    if (token) this.client = new ServerClient(token);
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async send(msg: PostmarkSendInput): Promise<PostmarkSendResult> {
    if (!this.client) {
      return { ok: false, retryable: true, errorMessage: 'Postmark not configured' };
    }
    try {
      const res = await this.client.sendEmail({
        From:          msg.from,
        To:            msg.to,
        Subject:       msg.subject,
        HtmlBody:      msg.html,
        TextBody:      msg.text,
        MessageStream: msg.messageStream ?? process.env.POSTMARK_MESSAGE_STREAM ?? 'outbound',
        TrackOpens:    true,
        Metadata:      msg.metadata,
      });
      return { ok: true, providerMessageId: res.MessageID, retryable: false };
    } catch (err: unknown) {
      // Postmark SDK rejects with an HTTP-ish error carrying statusCode + code.
      const e = err as { statusCode?: number; code?: number; message?: string };
      const status = e.statusCode;
      // Transient: network error (no status) or any 5xx. Everything else (bad
      // request, invalid/inactive recipient, auth) is permanent — don't retry.
      const retryable = status === undefined || status >= 500;
      this.logger.warn(`Postmark send failed (status=${status ?? 'n/a'} code=${e.code ?? 'n/a'}): ${e.message}`);
      return { ok: false, retryable, errorCode: e.code, errorMessage: e.message ?? 'Postmark send failed' };
    }
  }
}
