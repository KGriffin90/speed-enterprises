/**
 * Centralized legal placeholders + document metadata.
 *
 * Every legal document under `content/legal/*.md` is written with `{{TOKEN}}`
 * placeholders. Fill the values below ONCE (ideally with your attorney) and they
 * propagate to every rendered document, the sign-up consent copy, and the
 * App Store privacy disclosures.
 *
 * Anything still wrapped in square brackets (e.g. "[COMPANY LEGAL NAME — …]")
 * is an UNFILLED placeholder and will render visibly so it can't ship by
 * accident. Do a final `grep -R "\[" ` over rendered output before publishing.
 *
 * `LEGAL_VERSIONS` is the source of truth for the version string recorded
 * against each user's acceptance at sign-up — bump the relevant value whenever
 * you materially change a document so the audit trail stays meaningful.
 */

export const LEGAL_PLACEHOLDERS: Record<string, string> = {
  // ── Entity identity ────────────────────────────────────────────────────────
  COMPANY_LEGAL_NAME:  '[COMPANY LEGAL NAME — e.g., Acme Technologies, Inc.]',
  COMPANY_SHORT_NAME:  '[COMPANY SHORT NAME — e.g., Acme]',
  ENTITY_TYPE:         '[ENTITY TYPE — e.g., a Delaware corporation]',
  PLATFORM_NAME:       '[PLATFORM/PRODUCT NAME — the SaaS service]',
  APP_NAME:            '[MOBILE APP NAME — as listed on the App Store]',

  // ── Web + contact ──────────────────────────────────────────────────────────
  WEBSITE_URL:         '[https://your-domain.example]',
  SUPPORT_EMAIL:       '[support@your-domain.example]',
  PRIVACY_EMAIL:       '[privacy@your-domain.example]',
  SECURITY_EMAIL:      '[security@your-domain.example]',
  LEGAL_EMAIL:         '[legal@your-domain.example]',
  POSTAL_ADDRESS:      '[COMPANY MAILING ADDRESS — street, city, state, ZIP, country]',
  COMPANY_PHONE:       '[COMPANY PHONE]',

  // ── Privacy roles / representatives ─────────────────────────────────────────
  DPO_CONTACT:         '[DATA PROTECTION OFFICER or privacy contact name/email — or "Not applicable"]',
  EU_REP:              '[EU REPRESENTATIVE name + address (GDPR Art. 27) — or "Not applicable; we do not target the EEA"]',
  UK_REP:              '[UK REPRESENTATIVE name + address (UK GDPR Art. 27) — or "Not applicable; we do not target the UK"]',

  // ── Governing law / disputes ────────────────────────────────────────────────
  GOVERNING_STATE:     '[GOVERNING STATE — e.g., Utah]',
  GOVERNING_COUNTRY:   '[GOVERNING COUNTRY — e.g., United States]',
  VENUE_COURTS:        '[COURTS / VENUE — e.g., the state and federal courts located in Salt Lake County, Utah]',
  ARBITRATION_BODY:    '[ARBITRATION PROVIDER — e.g., JAMS or the American Arbitration Association (AAA)]',
  ARBITRATION_RULES:   '[ARBITRATION RULES — e.g., the AAA Consumer Arbitration Rules]',

  // ── Dates / versions (mirror LEGAL_VERSIONS below) ──────────────────────────
  EFFECTIVE_DATE:      '[EFFECTIVE DATE — e.g., June 13, 2026]',
  LAST_UPDATED:        '[LAST UPDATED — e.g., June 13, 2026]',

  // ── Operational specifics counsel should confirm ────────────────────────────
  DATA_RETENTION_YEARS: '[NUMBER]',     // e.g. 7 — how long records are kept post-closure
  AGE_MINIMUM:          '18',           // minimum age to use the Service
  PAYMENT_PROCESSOR:    '[PAYMENT PROCESSOR — e.g., Stripe, Inc. — or "Not applicable"]',
};

/**
 * Document version strings recorded against a user's consent. Date-based
 * versioning ("YYYY-MM-DD") keeps the audit trail human-readable. Bump on any
 * material change.
 */
export const LEGAL_VERSIONS = {
  terms:   '2026-06-13',
  privacy: '2026-06-13',
  eula:    '2026-06-13',
} as const;

export type LegalSlug =
  | 'privacy-policy'
  | 'terms-of-service'
  | 'eula'
  | 'acceptable-use-policy'
  | 'cookie-policy'
  | 'business-services-agreement'
  | 'data-processing-addendum'
  | 'subprocessors';

export interface LegalDocMeta {
  slug: LegalSlug;
  title: string;
  /** One-line description for the /legal index. */
  summary: string;
  /** Audience grouping for the index page. */
  audience: 'everyone' | 'consumers' | 'businesses';
}

export const LEGAL_DOCS: LegalDocMeta[] = [
  { slug: 'privacy-policy',              title: 'Privacy Policy',               summary: 'What personal data we collect, why, your rights, and how to exercise them.', audience: 'everyone' },
  { slug: 'terms-of-service',            title: 'Terms of Service',             summary: 'The agreement governing your use of the platform, website, and app.',         audience: 'everyone' },
  { slug: 'eula',                        title: 'End User License Agreement',   summary: 'The license terms for the mobile application, including Apple-required terms.', audience: 'consumers' },
  { slug: 'acceptable-use-policy',       title: 'Acceptable Use Policy',        summary: 'What you may and may not do when using the Service.',                          audience: 'everyone' },
  { slug: 'cookie-policy',               title: 'Cookie Policy',                summary: 'How we use cookies and similar technologies, and your choices.',               audience: 'everyone' },
  { slug: 'business-services-agreement', title: 'Business Services Agreement',  summary: 'Master terms for trade businesses that operate on the platform (tenants).',    audience: 'businesses' },
  { slug: 'data-processing-addendum',    title: 'Data Processing Addendum',     summary: 'GDPR/UK-GDPR/CCPA processor terms between us and business customers.',          audience: 'businesses' },
  { slug: 'subprocessors',               title: 'Subprocessors',                summary: 'Third parties that may process personal data on our behalf.',                  audience: 'businesses' },
];

/** Replace every {{TOKEN}} in a document with its configured value. */
export function fillPlaceholders(markdown: string): string {
  return markdown.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, token: string) => {
    const value = LEGAL_PLACEHOLDERS[token];
    return value ?? `[[UNDEFINED PLACEHOLDER: ${token}]]`;
  });
}
