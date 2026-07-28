# Speed Enterprises

The standalone operations app for **Speed Enterprises** — professional window
cleaning in Salt Lake City, UT. Public marketing site + question-driven quote
wizard, a customer dashboard, an admin/owner back office, and a companion mobile
app, all backed by one typed `BusinessConfig`.

This project was extracted as a self-contained carbon copy of the Speed
Enterprises tenant from the multi-tenant Trade Platform. It keeps that exact
architecture (tenant resolution, request-scoped tenant context, tenant-scoped
Prisma + Postgres RLS, the generic quote/pricing engine, per-tenant email
templates) but ships, seeds, and defaults to a single business: Speed
Enterprises. Everything runs the same; there is just one tenant.

## What's inside

- `packages/shared` — the full `BusinessConfig` zod schema + TypeScript types and DTOs.
- `apps/api` — NestJS backend:
  - Tenant resolution (JWT > header > host) + request-scoped `TenantContext` + tenant-scoped Prisma extension.
  - Auth with platform `User` + per-tenant `TenantMembership`.
  - Generic service-agnostic quote engine (`QuoteRequest`, polymorphic `QuoteLineItem`, deterministic pricing engine that evaluates `PricingRule[]`).
  - Per-tenant email templates (Handlebars-style), brand-aware HTML wrapper, seeded defaults.
  - Per-tenant S3 prefixing for uploads (works in local-dev mode out of the box).
  - Platform-admin module (the architecture is retained; only Speed Enterprises is seeded).
  - Audit log for sensitive actions.
- `apps/web` — Next.js 14 frontend with tenant-themed SSR landing pages and the generic question-driven quote wizard. Bare `localhost:3000` renders Speed Enterprises (see `NEXT_PUBLIC_DEFAULT_TENANT`).
- `apps/mobile` — Expo / React Native app (customer, staff, and admin flows) including a native iOS AR window-measure module (`apps/mobile/modules/ar-window-measure`).

## Quick start

```bash
# 1. Install
pnpm install

# 2. Start Postgres + Mailhog
pnpm db:up

# 3. Build the shared package (so the API can import it)
pnpm build:shared

# 4. Run Prisma migration + seed (seeds platform admin + Speed Enterprises)
pnpm prisma:generate
pnpm prisma:migrate
pnpm seed

# 5. Run the API + web together
pnpm dev                # API → http://localhost:4000, Web → http://localhost:3000
```

Verify the tenant is live:

```bash
curl http://localhost:4000/api/config/speedenterprises | jq '.businessName, .industry, .services | length'
```

Swagger docs: <http://localhost:4000/docs>
Mailhog (all dev email): <http://localhost:8026>
Postgres: `localhost:5433` (host port → container 5432)

## Viewing the web app

`apps/web` resolves the active tenant from the request. Because this is a
single-tenant deployment, `NEXT_PUBLIC_DEFAULT_TENANT=speedenterprises` makes
every entry point render Speed Enterprises:

- <http://localhost:3000> — Speed Enterprises landing page (hero + service grid from `BusinessConfig`).
- <http://speedenterprises.localhost:3000> — subdomain resolution still works.
- <http://localhost:3000/?tenant=speedenterprises> — query-param resolution still works.

Then:

- Quote wizard (`/quote/new` → `/quote/<service-slug>`) — fully dynamic from `Service.questions`. Try "Residential Window Cleaning".
- Thanks page (`/quote/thanks`) — branded confirmation; the matching email lands in Mailhog within a second.

### Mobile

```bash
cd apps/mobile
cp .env.example .env     # already points at http://localhost:4000
npx expo prebuild        # regenerates ios/ (and android/) native projects
npx expo run:ios         # or: npx expo start
```

The native `ios/` project is intentionally not committed — Expo regenerates it
from `app.json` + `modules/` (Continuous Native Generation). The AR window-measure
module is autolinked from `apps/mobile/modules`.

### Default credentials (dev seed)

| Role | Email | Password |
|---|---|---|
| Platform admin | `admin@speedenterprises.app` | `Admin!Platform2026` |
| Speed Enterprises owner | `owner@speedenterprises.com` | `Speed!Owner2026` |

The seed creates only the platform admin and the business owner — no demo
customers or staff. Customers and staff come from real sign-ups / the Team
screen, so the web and mobile UIs always reflect the live database.

Override the platform admin via `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` before seeding.

## The core idea — `BusinessConfig`

Every per-tenant value lives in one validated payload. `GET /api/config/:slug`
returns it; web renders themed UI from it; mobile loads it at boot.

```ts
import { parseBusinessConfig, type BusinessConfig } from '@speed-enterprises/shared';

const cfg: BusinessConfig = parseBusinessConfig(
  await fetch('/api/config/speedenterprises').then(r => r.json()),
);
cfg.businessName;             // "Speed Enterprises"
cfg.branding.colors.brand500; // "#c2410c"
cfg.services[0].questions;    // [{ id: 'window_count', type: 'number', … }, …]
```

## Multi-tenant safety (retained)

Two redundant layers:

1. **App-layer Prisma extension** (`tenant-prisma.service.ts`) — every query against a tenant-scoped model has `where: { tenantId }` injected; every write has `tenantId` stamped. Cross-tenant `update`/`delete` throws `ForbiddenException`.
2. **Postgres row-level security** — apply with `pnpm --filter @speed-enterprises/api db:rls` after `pnpm prisma:migrate`. `PrismaService.withTenantTx({ tenantId })` wraps a transaction with `SET LOCAL app.tenant_id`; RLS enforces the boundary in the database itself. Verify with `pnpm --filter @speed-enterprises/api db:rls:verify`.

## Per-tenant resolution

`TenantMiddleware` resolves the active tenant in order:

1. JWT claim `tenantId` (authenticated requests).
2. `X-Tenant-Slug` header (anonymous public endpoints / mobile boot).
3. Host subdomain / custom domain.

In this single-tenant build the web layer additionally falls back to
`NEXT_PUBLIC_DEFAULT_TENANT` (`speedenterprises`) when no other signal resolves.

## Generic quote engine

- **`Service.questions`** — wizard questions, defined as data.
- **`Service.pricingRules`** — rules that turn answers into a price, also data.
- **`QuoteRequest.answers`** — customer responses (validated against `Service.questions`).
- **`QuoteLineItem`** — polymorphic line items (window cleaning → `kind='window'` with `{ widthInches, heightInches }`).
- **`pricing-engine.ts`** — deterministic evaluator: base price + answers + rules → total + structured breakdown, persisted to `QuoteRequest.pricingBreakdown`.

The window-cleaning AR scanner maps to `Service.capabilities = ['window_rectangle_scan']`.

## Status lifecycle

`NEW → REVIEWING → ESTIMATE_SENT → ACCEPTED → SCHEDULED → IN_PROGRESS → COMPLETED → INVOICED → PAID`.
Illegal transitions are rejected; every change is recorded in `QuoteStatusHistory` and emits an `AuditLog` entry.

## Key design decisions

- **Identity ≠ tenancy.** `User` is platform-level; `TenantMembership` grants tenant access with a role.
- **JSONB for variable shape, columns for invariants.** Branding/contact/scheduling/automation/ai/payments/features are JSONB on `TenantConfig`, validated by zod at every boundary.
- **Cents, not floats.** Money is `Int`; multipliers stored as floats, applied with explicit rounding, delta recorded in the breakdown.
- **Public-quote endpoint is throttled and tenant-scoped via header.**
