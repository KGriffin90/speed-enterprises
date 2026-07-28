import { Logger } from '@nestjs/common';

/** The insecure fallback in tenant.module.ts — must never be used in prod. */
const DEV_JWT_SECRET = 'dev-only-insecure-secret';

/**
 * Fail-closed production configuration check, run at bootstrap before the app
 * accepts traffic.
 *
 * In production, missing/weak critical secrets THROW (the process exits) rather
 * than letting the API run with a known-public JWT secret — which would let
 * anyone forge a PLATFORM_ADMIN token and bypass auth + tenant isolation
 * entirely. Non-critical-but-recommended settings only warn.
 */
export function validateEnv(): void {
  const logger = new Logger('Env');
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) return; // dev/test may use defaults

  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Hard requirements (block startup) ────────────────────────────────────
  const jwt = process.env.JWT_SECRET;
  if (!jwt || jwt === DEV_JWT_SECRET) {
    errors.push('JWT_SECRET must be set to a strong secret (never the dev default).');
  } else if (jwt.length < 32) {
    errors.push('JWT_SECRET is too short — use at least 32 random characters.');
  }
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL must be set.');
  }
  // WEB_ORIGIN is baked into every customer-facing email link — appointment
  // reschedule/cancel tokens, proposed-slot confirmations, estimate links. Left
  // at its localhost default in production it doesn't degrade, it mails dead
  // URLs to real customers, and it also breaks mobile deep-link verification
  // (the domain in the link must be one the app is entitled to open).
  const webOrigin = process.env.WEB_ORIGIN;
  if (!webOrigin) {
    errors.push('WEB_ORIGIN must be set — it is baked into every customer email link.');
  } else if (!webOrigin.startsWith('https://')) {
    errors.push(`WEB_ORIGIN must be a public https origin (got "${webOrigin}") — email links must not point at localhost or plain http.`);
  }

  // ── Strongly recommended (warn only) ─────────────────────────────────────
  if (!process.env.REDIS_URL) {
    warnings.push('REDIS_URL not set — rate limits are per-instance, not shared across replicas.');
  }
  if (!process.env.CORS_ORIGINS) {
    warnings.push('CORS_ORIGINS not set — defaulting to http://localhost:3000, which will block your real frontend.');
  }
  if (process.env.TRUST_PROXY_HOPS === undefined) {
    warnings.push('TRUST_PROXY_HOPS not set — defaulting to 1; set it to your real proxy hop count.');
  }
  if (!process.env.S3_BUCKET || !process.env.S3_REGION) {
    warnings.push('S3_BUCKET/S3_REGION not set — file uploads fall back to the local-dev stub.');
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    warnings.push('STRIPE_WEBHOOK_SECRET not set — Stripe webhooks will fail signature verification.');
  }

  for (const w of warnings) logger.warn(w);
  if (errors.length) {
    for (const e of errors) logger.error(e);
    throw new Error(
      `Refusing to start: ${errors.length} critical production configuration error(s) — see logs above.`,
    );
  }
}
