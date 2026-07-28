import { Injectable, Logger } from '@nestjs/common';

/**
 * Port for an embedded-payroll provider (Gusto Embedded). The rest of the app
 * depends only on this interface, so swapping or finishing the provider is a
 * single-class change.
 *
 * SECURITY CONTRACT: implementations MUST collect SSN, bank, and tax data only
 * through the provider's own hosted onboarding (the URLs returned below). Those
 * details must never be accepted as arguments here, returned, logged, or stored.
 * We persist only opaque provider ids + computed amounts.
 */
export interface PayrollEmployeeInput {
  membershipId: string;
  email: string;
  fullName?: string | null;
}

export interface PayRunLineInput {
  providerEmployeeId: string;
  workedMinutes: number;
  grossPayCents: number;
}

export interface PayrollProvider {
  readonly name: string;
  /** True once the provider has the credentials it needs (e.g. GUSTO_API_KEY). */
  isConfigured(): boolean;

  // ── Company (tenant) onboarding ──
  createCompany(input: { tenantId: string; legalName: string }): Promise<{ providerCompanyId: string }>;
  companyOnboardingUrl(providerCompanyId: string, returnUrl: string): Promise<{ url: string }>;

  // ── Employee onboarding (worker enters SSN/bank at the provider) ──
  createEmployee(providerCompanyId: string, employee: PayrollEmployeeInput): Promise<{ providerEmployeeId: string }>;
  employeeOnboardingUrl(providerEmployeeId: string, returnUrl: string): Promise<{ url: string }>;

  // ── Pay run (provider performs the disbursement) ──
  createPayRun(input: {
    providerCompanyId: string;
    periodStart: string;
    periodEnd: string;
    lines: PayRunLineInput[];
    idempotencyKey: string;
  }): Promise<{ providerPayrollId: string }>;
  approvePayRun(providerPayrollId: string): Promise<void>;

  // ── Webhooks (status updates) ──
  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): { type: string; data: unknown };
}

/** DI token for the active payroll provider. */
export const PAYROLL_PROVIDER = 'PAYROLL_PROVIDER';

/** Thrown by provider methods whose REST call still needs to be wired to Gusto. */
export class PayrollNotWiredError extends Error {
  constructor(method: string) {
    super(
      `Gusto payroll "${method}" is not wired yet. The transport, config, and data model are ready — ` +
      `implement this call against the Gusto Embedded REST docs once you have sandbox keys + company info.`,
    );
    this.name = 'PayrollNotWiredError';
  }
}

/**
 * Gusto Embedded adapter — scaffold.
 *
 * Everything provider-agnostic is done: config gating, an authenticated JSON
 * transport (`gustoFetch`), and the method surface. Each method's exact REST
 * endpoint/payload is the one thing to confirm against Gusto's docs once keys
 * land; until then they throw a clear, actionable error (never reached while
 * unconfigured, because PayrollService gates on `isConfigured()` first).
 *
 * Env:
 *   GUSTO_API_KEY         partner access token (sandbox/live)
 *   GUSTO_API_BASE        defaults to the Gusto demo/sandbox host
 *   GUSTO_WEBHOOK_SECRET  used to verify inbound webhook signatures
 */
@Injectable()
export class GustoPayrollProvider implements PayrollProvider {
  readonly name = 'gusto';
  private readonly logger = new Logger(GustoPayrollProvider.name);

  private get apiKey(): string { return process.env.GUSTO_API_KEY ?? ''; }
  private get apiBase(): string { return process.env.GUSTO_API_BASE ?? 'https://api.gusto-demo.com'; }

  isConfigured(): boolean { return this.apiKey.length > 0; }

  /** Authenticated JSON transport to Gusto. Ready to use once endpoints are wired. */
  protected async gustoFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Gusto ${path} → ${res.status}`);
      throw new Error(`Gusto ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  // TODO(gusto): wire each call to the Gusto Embedded REST endpoint. The transport
  // above (auth, base URL, JSON, timeout) is ready — confirm paths/fields in docs.
  async createCompany(_input: { tenantId: string; legalName: string }): Promise<{ providerCompanyId: string }> {
    throw new PayrollNotWiredError('createCompany');
  }
  async companyOnboardingUrl(_providerCompanyId: string, _returnUrl: string): Promise<{ url: string }> {
    throw new PayrollNotWiredError('companyOnboardingUrl');
  }
  async createEmployee(_companyId: string, _employee: PayrollEmployeeInput): Promise<{ providerEmployeeId: string }> {
    throw new PayrollNotWiredError('createEmployee');
  }
  async employeeOnboardingUrl(_providerEmployeeId: string, _returnUrl: string): Promise<{ url: string }> {
    throw new PayrollNotWiredError('employeeOnboardingUrl');
  }
  async createPayRun(_input: {
    providerCompanyId: string; periodStart: string; periodEnd: string;
    lines: PayRunLineInput[]; idempotencyKey: string;
  }): Promise<{ providerPayrollId: string }> {
    throw new PayrollNotWiredError('createPayRun');
  }
  async approvePayRun(_providerPayrollId: string): Promise<void> {
    throw new PayrollNotWiredError('approvePayRun');
  }
  verifyWebhook(_rawBody: Buffer | string, _signature: string | undefined): { type: string; data: unknown } {
    // TODO(gusto): verify the HMAC signature with GUSTO_WEBHOOK_SECRET, then return
    // the parsed event { type, data }.
    throw new PayrollNotWiredError('verifyWebhook');
  }
}
