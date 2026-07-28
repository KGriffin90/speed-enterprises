# App Store Legal & Privacy Readiness

Companion to `LAUNCH-READINESS.md`. This file covers the **legal/privacy** work added
for App Store submission and the **manual steps you must complete** before you ship.

> **Not legal advice.** The documents under `apps/web/src/content/legal/` are thorough
> templates grounded in this app's actual data flows. Have a licensed attorney in your
> operating jurisdiction review them before publishing. Every company-specific value is a
> visible placeholder — see "Fill these in" below.

---

## What was added

### Legal documents (hosted by the web app)
Markdown sources live in `apps/web/src/content/legal/` and render at public URLs:

| Document | URL |
| --- | --- |
| Privacy Policy | `/legal/privacy-policy` |
| Terms of Service | `/legal/terms-of-service` |
| End User License Agreement (EULA) | `/legal/eula` |
| Acceptable Use Policy | `/legal/acceptable-use-policy` |
| Cookie Policy | `/legal/cookie-policy` |
| Business Services Agreement | `/legal/business-services-agreement` |
| Data Processing Addendum (DPA) | `/legal/data-processing-addendum` |
| Subprocessors | `/legal/subprocessors` |
| Index | `/legal` |

The EULA includes Apple's required **Licensed Application End User License Agreement**
minimum terms (incl. Apple as a third-party beneficiary).

### Consent capture at account creation
- **Web** (`apps/web/.../auth/sign-up/SignUpForm.tsx`) and **mobile**
  (`apps/mobile/app/(auth)/sign-up.tsx`) now require an explicit checkbox agreeing to the
  Terms, EULA, and Privacy Policy, with tappable links. A separate optional marketing
  opt-in is recorded to `CustomerProfile.marketingConsent`.
- **API gate** (`RegisterDto.acceptTerms` must be `true`) — registration is rejected
  without consent, enforced in both the DTO and `auth.service`.
- **Audit trail** — a new `LegalAcceptance` table (catalog DB) records one immutable row
  per accepted document with version, timestamp, IP, and user-agent. Migration:
  `20260614004801_add_legal_acceptance` (already applied to the catalog + all tenant DBs).

### In-app discoverability
- Mobile **Account** screen has a Legal section linking to each hosted document.
- Web footer links to Privacy, Terms, Cookies, and the Legal index.

### Account deletion
Already implemented (`DELETE /api/me/account` + double-confirm UI) — satisfies
**App Store Guideline 5.1.1(v)**. No change needed.

---

## ⚠️ Fill these in before publishing

1. **`apps/web/src/content/legal/config.ts`** — replace every value in `LEGAL_PLACEHOLDERS`
   (company legal name, entity type, addresses, emails, governing state, arbitration body,
   EU/UK representatives, effective dates, retention period, etc.). Anything left in
   `[brackets]` renders visibly. Final check: `grep -RnE "\[[A-Z]" apps/web/src/content/legal`.
2. **`apps/web/src/content/legal/subprocessors.md`** — complete the vendor table with your
   real subprocessors (hosting, storage, email, monitoring, push, auth, payments) and regions.
3. **`LEGAL_VERSIONS`** (web `config.ts`) and **`apps/mobile/src/lib/legal.ts`
   (`LEGAL_VERSIONS`)** — keep these two in sync. Bump on any material document change.
4. **`EXPO_PUBLIC_WEB_URL`** — set to your production web origin so the app's legal links
   and the App Store URLs resolve (e.g. `https://app.yourdomain.com`). Default is a
   placeholder. Add to `eas.json` build env and `.env.example`.
5. **App Store Connect** — set the **Privacy Policy URL** to `https://<web>/legal/privacy-policy`
   and, under App Information → License Agreement, either use Apple's standard EULA or paste
   a link to `/legal/eula` (custom EULAs are entered in App Store Connect).

---

## App Privacy "Nutrition Labels" (App Store Connect questionnaire)

Based on the current data model. Confirm against your final build; declare **Data Linked to You**
unless you truly de-identify. We do **not** use data for tracking (no ATT prompt required).

| Data type | Collected | Linked to user | Purpose | Notes |
| --- | --- | --- | --- | --- |
| Name | Yes | Yes | App Functionality | Quote/account |
| Email address | Yes | Yes | App Functionality | Account, notifications |
| Phone number | Yes | Yes | App Functionality | Contact for service |
| Physical address | Yes | Yes | App Functionality | Service location |
| Precise location | Yes (staff only) | Yes | App Functionality | Foreground, on-the-clock route tracking only |
| Photos | Yes | Yes | App Functionality | Job/property photos |
| Other user content | Yes | Yes | App Functionality | Notes, measurements |
| Identifiers (user ID) | Yes | Yes | App Functionality | Account identity |
| Coarse location / IP | Yes | Yes | App Functionality, Security | Session/audit logging |
| Usage data / diagnostics | Yes | Yes/No | Analytics, App Functionality | Error monitoring |
| Purchases (if payments enabled) | Maybe | Yes | App Functionality | Only if you enable payments |
| Sensitive info | No | — | — | Not intentionally collected |
| Data used for tracking | No | — | — | No cross-app/advertising tracking |

---

## Guideline checklist

- [x] **5.1.1(v) Account deletion** — in-app, implemented.
- [x] **5.1.1(i) Privacy policy** — written + hosted; set the URL in App Store Connect.
- [x] **5.1.1 Data collection & consent** — explicit consent at sign-up; transactional vs. marketing separated.
- [x] **5.1.2 Permission strings** — camera + when-in-use location only (see `LAUNCH-READINESS.md` items 9–11).
- [ ] **4.8 "Sign in with Apple"** — the data model has `googleId` (Google OAuth). **If the
      iOS app offers Google (or any third-party) login, Apple requires you to also offer an
      equivalent privacy-focused option (Sign in with Apple).** If the app uses only
      email/password, 4.8 does not apply. Confirm what the shipped app exposes and add Sign in
      with Apple if needed.
- [ ] **Demo account** — provide Apple a working customer (and admin) login in App Review notes.
- [ ] **EULA / Privacy URLs** entered in App Store Connect.
- [ ] **App Privacy** questionnaire completed per the table above.
- [ ] **Attorney review** of all documents and placeholder values.

---

## Where the data lives (for DSAR / deletion requests)

- **Identity + consent audit** (catalog DB): `User`, `RefreshToken`, `LegalAcceptance`.
- **Customer business data** (per-tenant DB): `CustomerProfile` (incl. `marketingConsent`),
  `QuoteRequest`, `UploadedImage`, `Appointment`.
- **Staff/operational** (per-tenant DB): `EmployeeProfile`, `TimeEntry`, `WorkRoute`,
  `RouteWaypoint` (precise location).
- Deletion: `DELETE /api/me/account` soft-deletes identity and revokes sessions; see the
  Privacy Policy §10 for the retention/erasure contract.
