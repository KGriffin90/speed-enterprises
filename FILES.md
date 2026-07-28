# File index — Speed Enterprises

## Root

- `README.md` — quick start + architecture summary
- `FILES.md` — this index
- `package.json` — pnpm workspace + root scripts
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `docker-compose.yml` — Postgres + Mailhog for dev
- `.env.example`
- `.gitignore`

## Docs

- `docs/01-getting-started.md` — install, run, common workflows

## Shared package (`packages/shared/`)

- `package.json`, `tsconfig.json`
- `src/index.ts` — barrel
- `src/enums.ts` — Industry, QuoteStatus, TenantRole, PlatformRole, MessageKind, LineItemKind, …
- `src/config.ts` — every per-tenant schema (Branding, Contact, Scheduling, Question, PricingRule, Service, MessageTemplate, Automation, AI, Payments, Features, BusinessConfig)
- `src/dto/auth.ts` — Register/Login/Verify/Reset/Refresh/SwitchTenant
- `src/dto/quotes.ts` — CreateQuote, UpdateQuote, ChangeStatus, SendEstimate, PublicQuoteRequest, AddLineItem
- `src/dto/services.ts` — CreateService, UpdateService
- `src/dto/tenant.ts` — CreateTenant, UpdateTenantConfig, InviteMember, SetTenantStatus

## API (`apps/api/`)

- `package.json`, `tsconfig.json`, `nest-cli.json`, `.env.example`

### Prisma

- `prisma/schema.prisma` — multi-tenant schema (Tenant, TenantConfig, Membership, User, Service, QuoteRequest, QuoteLineItem, MessageTemplate, EmailLog, AuditLog, …)
- `prisma/seed.ts` — orchestrator
- `prisma/seeds/service-templates.ts` — industry catalog
- `prisma/seeds/speed-enterprises.ts` — the seeded tenant (window cleaning)

### Source

- `src/main.ts` — bootstrap (helmet, CORS, validation, Swagger)
- `src/app.module.ts` — module composition + TenantMiddleware wiring
- `src/health/health.controller.ts` — `/health`, `/version`
- `src/prisma/{prisma.module,prisma.service}.ts` — global Prisma client
- `src/tenant/`
  - `tenant-context.ts` — request-scoped context (tenantId, userId, roles)
  - `tenant.middleware.ts` — resolves tenant (JWT > header > host)
  - `tenant.service.ts` — lookup + cache (slug, id, custom domain)
  - `tenant-prisma.service.ts` — Prisma `$extends` that injects `where: { tenantId }` on every tenant-scoped operation
  - `tenant.module.ts`
- `src/common/`
  - `current-tenant.decorator.ts` — `@CurrentTenant() tenantId: string`
  - `current-user.decorator.ts` — `@CurrentUser() me: CurrentUserInfo`
  - `guards.ts` — `TenantGuard`, `AuthGuard`, `RolesGuard`, `@RequireTenantRole`, `@RequirePlatformRole`
- `src/auth/`
  - `auth.service.ts` — register, verify, login, switch-tenant, refresh, forgot/reset
  - `auth.controller.ts` — routes
  - `auth.module.ts`
- `src/messaging/`
  - `default-templates.ts` — 13 platform-default email templates (Handlebars-style)
  - `email-renderer.ts` — markdown-ish → HTML, tenant-branded wrapper
  - `messaging.service.ts` — tenant-aware dispatcher (Resend in prod, Mailhog/console in dev)
  - `messaging.module.ts`
- `src/config/`
  - `config.service.ts` — assembles + validates the full BusinessConfig
  - `config.controller.ts` — `GET /config/:slug`, `GET /me/config`, `PATCH /me/config`
  - `config.module.ts`
- `src/services/`
  - `services.service.ts` — tenant Service CRUD
  - `services.controller.ts` — `/services`, `/services/public`
  - `services.module.ts`
- `src/quotes/`
  - `pricing-engine.ts` — deterministic rule evaluator with breakdown
  - `question-validator.ts` — coerces + validates answers against Service.questions
  - `quotes.service.ts` — create/update/submit + admin status/estimate + line items + notifications
  - `quotes.controller.ts` — customer + admin + public endpoints
  - `quotes.module.ts`
- `src/uploads/`
  - `uploads.service.ts` — presigned upload URLs scoped to `tenants/<id>/quotes/<id>/`
  - `uploads.controller.ts`
  - `uploads.module.ts`
- `src/platform/`
  - `platform.service.ts` — super-admin: createTenant, listTenants, setStatus, inviteMember
  - `platform.controller.ts` — `/platform/tenants`, …
  - `platform.module.ts`
