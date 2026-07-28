# Cross-Plane Service Conversion Playbook

Companion to `02-tenant-isolation-architecture.md`. This is the precise,
service-by-service plan for moving data access onto the per-tenant database —
and an honest correction of the earlier claim that it's "mechanical." It isn't,
because the data model has relations that cross the control-plane/data-plane
boundary. This document is the map of those crossings and how to handle each.

---

## 1. Which database each model lives in

**Catalog (control plane) — identity & registry:**
`User`, `RefreshToken`, `VerificationToken`, `PlatformAdmin`, `ServiceTemplate`,
`Tenant`, `TenantMembership`.

**Tenant (data plane) — one physical DB per tenant:**
`TenantConfig`, `Service`, `MessageTemplate`, `QuoteRequest`, `QuoteLineItem`,
`UploadedImage`, `QuoteStatusHistory`, `EmailLog`, `CustomerProfile`,
`EmployeeProfile`, `TimeEntry`, `WorkRoute`, `RouteWaypoint`, `AuditLog`.

The boundary is drawn so that everything needed to answer "who is this user and
which businesses can they access?" is in the catalog (queried before a tenant DB
is selected), and everything that is a tenant's private business data is in that
tenant's own database.

---

## 2. The real blocker: foreign keys that cross the boundary

Several tenant-plane tables have **FK relations to catalog-plane tables**. Once
the tenant row lives in its own database, that FK references a row that isn't
there — so the constraint fails on insert and `include` returns null on read.

| Tenant-plane column | → references | Fix |
|---|---|---|
| `QuoteRequest.userId` | `User` | drop FK relation; keep `userId String?` as a soft reference |
| `QuoteStatusHistory.changedById` | `User` | drop FK; keep `changedById String` |
| `AuditLog.actorUserId` | `User` | drop FK; keep `actorUserId String?` |
| `CustomerProfile.userId` | `User` | drop FK; keep `userId String` |
| `UploadedImage.uploadedById` | `User` | already just a string — confirm no relation |
| `TimeEntry.membershipId` | `TenantMembership` | drop FK; keep `membershipId String` |
| `WorkRoute.membershipId` | `TenantMembership` | drop FK; keep `membershipId String` |
| `EmployeeProfile.membershipId` | `TenantMembership` | drop FK; keep `membershipId String` |

**This is a schema migration, not a code change**, and it must land *before* the
cross-plane services are converted. In the single-schema design these columns
stay; we only remove the Prisma `@relation` (and the DB-level FK) so the id
becomes a plain stored value. Reads that used `include` switch to the
`hydrate()` helper (see §4). Writes already pass the id directly, so they keep
working once the FK is gone.

> Do this as an **expand/contract** migration: first remove the FK constraints
> (expand, backward-compatible), deploy code that uses `hydrate()`, then — only
> after db-per-tenant is live — drop the now-unused relation fields if desired.

---

## 3. Service-by-service status

| Service | Plane | Status | Notes |
|---|---|---|---|
| `services` | tenant | ✅ converted | worked example (doc 02 §5.3) |
| `templates` | tenant | ✅ converted | single-plane, single injector |
| `uploads` | tenant | ✅ converted | single-plane |
| `payments` | tenant | ✅ converted | only TenantConfig.payments |
| `ai` | tenant | ✅ converted | removed a redundant cross-plane `include: { tenant }` |
| `tenant` (registry) | catalog | ✅ converted | now uses `CatalogPrismaService` |
| `config` | **cross** | ⛔ pending | assembles `Tenant`(catalog) + `TenantConfig`/`Service`/`MessageTemplate`(tenant) |
| `quotes` | **cross** | ⛔ pending | `QuoteRequest`→`User`; status/audit FKs (§2) |
| `me` | **cross** | ⛔ pending | identity (catalog) + `CustomerProfile` (tenant) |
| `auth` | **cross** | ⛔ pending | identity (catalog) + `CustomerProfile` (tenant) on signup |
| `team` | **cross** | ⛔ pending | `TenantMembership`/`User` (catalog) + `EmployeeProfile`/`AuditLog` (tenant) |
| `time` | **cross** | ⛔ pending | `TimeEntry` (tenant) + `TenantMembership` (catalog) |
| `routes` | **cross** | ⛔ pending | `WorkRoute`/`RouteWaypoint` (tenant) + membership (catalog) |
| `messaging` | tenant, **batch** | ⛔ pending | must use `TenantDatabaseService` directly (called by `automation`) |
| `automation` | tenant, **batch** | ⛔ pending | scheduled cross-tenant job — no request scope |
| `platform` | **cross + batch** | ⛔ pending | platform-admin operations across all tenants + seeding |

---

## 4. Pattern A — request-scoped cross-plane read (worked: `quotes`)

`QuotesService.getById` currently does:

```ts
include: {
  lineItems: true, images: true, service: true,
  statusHistory: { orderBy: { createdAt: 'desc' } },
  user: { select: { email: true, customerProfiles: { where: { tenantId }, take: 1 } } },
}
```

`lineItems`, `images`, `service`, `statusHistory`, and `customerProfiles` are all
tenant-plane and stay in the `include`. Only `user` (email) is catalog-plane.
Split it:

```ts
import { Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../database/tenant-db.provider';
import { CatalogPrismaService } from '../database/catalog-prisma.service';
import { hydrate, loadUsersByIds } from '../database/cross-db';

constructor(
  @Inject(TENANT_DB) private prisma: PrismaClient,
  private catalog: CatalogPrismaService,
  private messaging: MessagingService,
) {}

async getById(tenantId: string, id: string) {
  const q = await this.prisma.quoteRequest.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: {
      lineItems: true, images: true, service: true,
      statusHistory: { orderBy: { createdAt: 'desc' } },
      // customerProfile is tenant-plane — fetch directly if you need it:
      // (CustomerProfile lives in the tenant DB keyed by userId+tenantId)
    },
  });
  if (!q) throw new NotFoundException();
  const [withUser] = await hydrate([q], {
    keyOf: (r) => r.userId,
    as: 'user',
    load: (ids) => loadUsersByIds(this.catalog, ids, { email: true }),
  });
  return withUser; // withUser.user is { id, email } | null
}
```

For list endpoints (`listMine`, `listAdmin`) the same `hydrate()` call batches all
userIds into **one** catalog query — no N+1. `listMine` also reads
`prisma.user.findUnique` up front for the guest-email match; that read moves to
`this.catalog.user.findUnique`.

The status-change / accept / estimate writes (`QuoteStatusHistory.create`,
`AuditLog.create` with `changedById`/`actorUserId`) work unchanged **once the
cross-plane FKs from §2 are removed** — they already pass the id, not a relation.

## 5. Pattern B — batch / cross-tenant code (`messaging`, `automation`, `platform`)

These run **without a request scope** (scheduled jobs, platform-admin tools that
sweep every tenant), so they CANNOT inject the request-scoped `TENANT_DB`.
Instead they take a `tenantId` and resolve the client explicitly:

```ts
constructor(
  private tenantDb: TenantDatabaseService,   // singleton router
  private catalog: CatalogPrismaService,
) {}

async sendForTenant({ tenantId, ... }: SendOpts) {
  const db = await this.tenantDb.clientFor(tenantId);   // tenant's own DB
  const template = await db.messageTemplate.findFirst({ where: { tenantId, kind, channel } });
  // ...
  await db.emailLog.create({ data: { tenantId, ... } });
}
```

`automation` (the scheduled sweep) iterates tenants from the catalog and calls
`clientFor(tenant.id)` for each:

```ts
const tenants = await this.catalog.tenant.findMany({
  where: { status: 'ACTIVE', deletedAt: null },
  select: { id: true },
});
for (const { id } of tenants) {
  const db = await this.tenantDb.clientFor(id);
  // ...do per-tenant work against `db`...
}
```

`platform` (admin) uses `catalog` for registry/identity and `clientFor(tenantId)`
when it needs to touch a specific tenant's business data (e.g. seeding default
`Service`/`MessageTemplate` rows at tenant creation — which should happen against
the new tenant's DB right after provisioning).

## 6. Pattern C — `config` assembly (cross-plane read)

`ConfigService.getBySlug` reads `Tenant` (catalog) and `TenantConfig` + `Service`
+ `MessageTemplate` (tenant). Split into two reads:

```ts
async getBySlug(slug: string) {
  const tenant = await this.catalog.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, industry: true, dbStatus: true },
  });
  if (!tenant) throw new NotFoundException();
  const db = await this.tenantDb.clientFor(tenant.id);
  const [config, services, messageTemplates] = await Promise.all([
    db.tenantConfig.findUnique({ where: { tenantId: tenant.id } }),
    db.service.findMany({ where: { tenantId: tenant.id, active: true, deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
    db.messageTemplate.findMany({ where: { tenantId: tenant.id } }),
  ]);
  if (!config) throw new NotFoundException('Tenant not configured');
  return this.assemble(tenant, config, services, messageTemplates);
}
```

---

## 7. Order of operations for the remaining work

1. **Schema migration**: remove the cross-plane FK relations in §2 (keep the
   columns). `prisma migrate dev --name decouple_cross_plane_fks`.
2. Convert **`messaging`** (Pattern B) — unblocks `quotes`, `auth`, `team`,
   `automation`, `platform`, which all call it.
3. Convert **`quotes`** (Pattern A) — highest-value entity.
4. Convert **`config`** (Pattern C) — public site + SSR depend on it.
5. Convert **`me`**, **`auth`** (identity-first; `CustomerProfile` via tenant client).
6. Convert **`team`**, **`time`**, **`routes`** (membership hydration via §4 helper).
7. Convert **`automation`**, **`platform`** (Pattern B batch).
8. Integration-test cross-tenant isolation, then flip `TENANCY_MODE`.

Each step is independently shippable in `pool` mode (where catalog == tenant DB),
so you can convert and deploy one service at a time with no behavior change, and
only the final flag flip activates physical isolation.
