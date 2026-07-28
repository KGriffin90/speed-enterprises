# Tenant Isolation Architecture — Database-per-Tenant

Status: **Foundation merged, flag-gated. Cut-over is staged.**
Owner: Platform
Audience: Anyone touching data access, auth, or provisioning.

---

## 0. The core problem

You sell this platform to independent local service businesses. Each one expects
that **their customers, quotes, pricing, and staff data are theirs alone** — not
sitting in the same table as a competitor's data, separated only by a `WHERE`
clause that one bug, one missing filter, or one `OR 1=1` could defeat.

Today the system is **one shared Postgres database** with isolation enforced by:

1. an app-layer Prisma `$extends` that injects `where: { tenantId }`, and
2. Postgres Row-Level Security policies as a second layer.

That is a genuinely good *pool* design. But it is still **logical** isolation: a
single forgotten filter, a raw query, or an RLS policy gap exposes every tenant
at once. For a product whose pitch is "your business, isolated and secure," the
blast radius of a single mistake is the whole customer base.

**Decision: move to database-per-tenant.** Each tenant gets a dedicated physical
Postgres database. A query simply *cannot* see another tenant's rows because the
rows are not in the same database. Isolation stops being a property you have to
prove on every code path and becomes a property of the topology.

---

## 1. Best recommendation

Adopt a **control-plane / data-plane split**:

- **Catalog database (control plane).** One shared database holding only the data
  you must read *before* you know which tenant DB to talk to: identity (`User`,
  `RefreshToken`, `VerificationToken`, `PlatformAdmin`), the tenant **registry**
  (`Tenant`, including each tenant's **encrypted** DB connection string),
  memberships, and the `ServiceTemplate` seed catalog.
- **Tenant databases (data plane).** One physical database **per tenant** holding
  all business and customer data: `TenantConfig`, `Service`, `QuoteRequest`,
  `CustomerProfile`, `MessageTemplate`, time tracking, routes, audit, etc.
- **A connection router** that turns a `tenantId` into the right pooled
  `PrismaClient`, resolving and decrypting that tenant's connection string from
  the catalog and caching the pool.

Reach the topology behind one environment flag, `TENANCY_MODE`:

- `pool` (default) — today's behavior, unchanged. Zero risk.
- `db-per-tenant` — physical isolation, per-request routing.

`pool` mode is the degenerate case of `db-per-tenant` where every tenant points
at the same database, so **both modes run the same code paths.** That is what
makes the migration reversible: flip the flag back and you are instantly on the
old topology.

For **navigation**, the active tenant is always derived from the request itself —
**subdomain in production** (`acme.speedenterprises.app`), **path in development**
(`/t/acme/…`) — never silently inherited from a cookie. The cookie becomes a
one-navigation-stale hint that can never override or outlive the URL.

---

## 2. Why this matters

- **Security is structural, not behavioral.** With pooling, "no cross-tenant
  read" is an invariant you must re-verify on every new query, migration, and
  raw SQL statement forever. With a DB per tenant, the database boundary enforces
  it for free. Defense-in-depth (the `tenantId` filters, RLS) stays on top.
- **Blast radius shrinks from "all tenants" to "one tenant."** A bad migration, a
  corrupt index, a runaway query, or a restore-from-backup affects exactly one
  customer, not the platform.
- **Per-tenant operations become possible:** per-tenant backup/restore,
  point-in-time recovery, data residency, "export everything and delete me"
  (GDPR/CCPA) by dropping a database, and per-tenant performance isolation (a
  noisy tenant can't lock another tenant's tables).
- **It's a sales asset.** "Your data lives in its own dedicated database, with
  its own credentials, encrypted at rest" is a concrete, auditable claim.

The cost is operational complexity — N databases to migrate, provision, monitor,
and pool. The rest of this document is about paying that cost safely.

---

## 3. Architecture

### 3.1 Components (all under `apps/api/src/database/`)

| File | Responsibility |
|------|----------------|
| `tenancy.config.ts` | Parses `TENANCY_MODE` + related env; fails loudly at boot if db-per-tenant is half-configured. |
| `connection-secret.ts` | AES-256-GCM envelope encryption for tenant connection strings, with a key ring for rotation. |
| `catalog-prisma.service.ts` | Singleton `PrismaClient` for the control-plane DB. |
| `tenant-connection.registry.ts` | Framework-agnostic **bounded LRU cache** of per-tenant `PrismaClient`s (pools). Idle eviction, concurrent-miss dedupe, shutdown. |
| `tenant-database.service.ts` | Turns a `tenantId` into the right client: shared (pool mode) or per-tenant (db-per-tenant mode). The **only** place a tenantId becomes a DB handle. |
| `tenant-db.provider.ts` | Request-scoped `TENANT_DB` injection token — the seam feature services use. Fails closed when no tenant is in scope. |
| `tenant-provisioning.service.ts` | Creates / migrates / drops a tenant database. |
| `../../prisma/migrate-all-tenants.ts` | Fan-out `migrate deploy` across every tenant DB. |

### 3.2 Request lifecycle (db-per-tenant mode)

```
HTTP request
  │
  ├─ Web edge middleware (apps/web/src/middleware.ts)
  │     host/path → slug → x-tenant-slug header (+ rewrite /t/<slug> away)
  │
  ├─ API TenantMiddleware
  │     JWT / x-tenant-slug / host → resolves tenantId via CATALOG
  │     cross-checks JWT tenant vs header tenant (403 on mismatch)
  │     populates request-scoped TenantContext
  │
  ├─ Controller resolves a feature service
  │     service injects TENANT_DB (request-scoped)
  │       → TenantDatabaseService.clientFor(ctx.tenantId)
  │         → registry.acquire(tenantId, resolveUrl)
  │           → CATALOG lookup → decrypt connection string → PrismaClient (cached)
  │
  └─ Query runs against the TENANT's own database. No tenantId needed for
     isolation; it's still passed as defense-in-depth.
```

### 3.3 Why one Prisma schema, not two generated clients

A tempting alternative is to generate two Prisma clients from two schemas
(`catalog.prisma`, `tenant.prisma`) so the compiler forbids touching business
tables on the catalog connection. We deliberately did **not** do that, because:

- It **doubles code generation** and forces every one of the ~19 feature
  services to switch to a differently-typed client — a large, risky rewrite for
  a marginal compile-time guarantee.
- The same physical isolation (a separate database per tenant — your actual
  requirement) is achieved with **one schema and N connections**:
  `new PrismaClient({ datasourceUrl })`. Each tenant DB is provisioned with the
  identical schema; the catalog DB holds identity/registry rows and simply never
  receives business writes (the routing seam guarantees that).

**Trade-off, stated honestly:** with a single schema the catalog database
physically *contains* the business tables (empty). A misrouted query could in
principle write a business row there. We mitigate with (a) the single routing
seam (`TenantDatabaseService`), (b) least-privilege DB roles, and (c) keeping the
`tenantId` defense-in-depth filters. If you later want the compiler to make
cross-plane access *unrepresentable*, splitting the schema is the upgrade — see
§8. For now the risk/reward favors one schema.

---

## 4. Implementation steps (staged, reversible)

**Stage 0 — Foundation (DONE, shipped in `pool` mode).**
Everything in §3.1 is merged and inert: `TENANCY_MODE` defaults to `pool`, so the
running app is byte-for-byte unchanged. The schema gained nullable catalog
columns on `Tenant` (`dbName`, `dbConnectionEnc`, `dbStatus`, …) — a backward-
compatible migration.

```bash
# Generate the additive migration for the new Tenant columns:
pnpm --filter @speed-enterprises/api prisma migrate dev --name tenant_db_provisioning_fields
```

**Stage 1 — Stand up the catalog database.**
Point `CATALOG_DATABASE_URL` at a dedicated DB and migrate it. In `pool` mode it
can stay equal to `DATABASE_URL`; in `db-per-tenant` it must be its own database.

**Stage 2 — Migrate feature services to the `TENANT_DB` seam.**
Each tenant-business service swaps its injected client. This is mechanical and
the call sites don't change (see §5.3). `ServicesService` is already converted as
the worked example. Identity/platform services (`auth`, `me`, `tenant`,
`platform`) instead use `CatalogPrismaService`.

**Stage 3 — Provision tenant databases (dual-write/backfill).**
For each existing tenant: create its DB, migrate it, copy its rows out of the
shared DB into its own, encrypt+store the connection string, flip
`dbStatus → READY`. Run this as a backfill job; keep `pool` mode live throughout.

**Stage 4 — Flip the flag per environment.**
Set `TENANCY_MODE=db-per-tenant` in staging, soak, then production. Rollback is
setting it back to `pool`.

**Stage 5 — Decommission shared business tables** (weeks later, once confident):
contract migration drops business tables from the catalog DB.

---

## 5. Code & file changes (what landed)

### 5.1 Schema (`apps/api/prisma/schema.prisma`)
Added `enum TenantDbStatus` and nullable provisioning columns on `Tenant`
(`dbName @unique`, `dbHost`, `dbConnectionEnc @db.Text`, `dbStatus`,
`dbProvisionedAt`). Additive and safe.

### 5.2 New data layer
See §3.1. Highlights:

- **Encryption** (`connection-secret.ts`): AES-256-GCM, 12-byte random IV per
  value, auth tag verified on decrypt (tampering fails closed). Key ring keyed by
  `keyId` so you can rotate: add a key, make it primary, re-encrypt, drop the old.
  Format: `v1:<keyId>:<iv>:<tag>:<ciphertext>` (base64url).
- **Registry** (`tenant-connection.registry.ts`): bounded LRU; hot tenants stay
  connected, cold tenants get disconnected and evicted; two simultaneous misses
  build exactly one client; idle sweep + graceful shutdown.

### 5.3 The migration pattern for a feature service

Before:

```ts
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}
  list(tenantId: string) {
    return this.prisma.service.findMany({ where: { tenantId, deletedAt: null } });
  }
}
```

After (only the injected client changes — every `this.prisma.*` call site is
identical, and the explicit `tenantId` filter stays as belt-and-suspenders):

```ts
import { Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../database/tenant-db.provider';
@Injectable()
export class ServicesService {
  constructor(@Inject(TENANT_DB) private prisma: PrismaClient) {}
  list(tenantId: string) {
    return this.prisma.service.findMany({ where: { tenantId, deletedAt: null } });
  }
}
```

**Correction (important):** this swap is only mechanical for services that touch
a *single plane*. Converted so far: `services`, `templates`, `uploads`,
`payments`, `ai` (→ `TENANT_DB`) and `tenant` (→ `CatalogPrismaService`).

The rest **cross the plane boundary** — e.g. `QuoteRequest`→`User`,
`TimeEntry`→`TenantMembership` — and have foreign keys that point from a
tenant-plane table to a catalog-plane table. Those FKs must be decoupled (a
schema migration) and the `include`s replaced with app-level joins before the
service can be converted. Blind-swapping them would break inserts (FK violation)
and reads (null relations). The full per-service plan, the FK list, and the
`hydrate()` join helper live in **`03-cross-plane-conversion.md`**. Batch/
cross-tenant code (`automation`, `platform`, `messaging`) must use
`TenantDatabaseService.clientFor(tenantId)` directly — it has no request scope
and cannot inject `TENANT_DB`.

### 5.4 Web navigation (`apps/web/src/middleware.ts`, `lib/tenant.ts`)
Rewritten so the tenant is derived from host (prod) or `/t/<slug>` path (dev),
the `/t/<slug>` prefix is rewritten away (the app tree stays flat), the cookie is
reconciled to the URL on every request and cleared on the apex, and the
server-side `getTenantSlug()` trusts **only** the middleware header — never the
lagging cookie.

---

## 6. Edge cases & failure modes

- **Tenant DB not provisioned / mid-provision.** `clientFor` throws
  `ServiceUnavailable` (503) rather than guessing a database. Provisioning writes
  `dbStatus` at each step so a crashed run is resumable; `READY` is only set after
  migrations actually succeed.
- **Decrypt failure** (key rotated out, tampering). Surfaced as a loud error; the
  process refuses to connect to anything. Never silently degrades.
- **Connection exhaustion at scale.** Each `PrismaClient` owns a pool. With
  thousands of tenants you can blow past Postgres `max_connections`. Mitigations:
  small per-tenant `connection_limit` (in `TENANT_DB_URL_TEMPLATE`), the bounded
  LRU (`TENANT_MAX_CLIENTS`), idle eviction (`TENANT_CLIENT_IDLE_MS`), and
  **PgBouncer** (transaction pooling) in front of Postgres for production scale.
- **Cross-tenant auth.** A user signed into tenant A who navigates to tenant B's
  subdomain: the API middleware cross-checks the JWT tenant against the host/header
  tenant and returns 403 (unless platform admin). The web layer shows B's shell;
  B's data calls fail closed. This is the desired behavior, not a bug.
- **Stale tenant cookie** (the original "wrong business after navigating" report):
  fixed structurally — host/path always win, the apex clears the cookie, and SSR
  reads the header only. Verified by the navigation test matrix (§7).
- **`/t/<slug>` under a real tenant subdomain** (`acme.speedenterprises.app/t/beta`):
  host wins, the path is stripped. No ambiguity.
- **Schema drift between tenant DBs.** A tenant whose `migrate deploy` failed is
  quarantined as `dbStatus=FAILED` and the fan-out runner exits non-zero, so a
  partial rollout is treated as a deploy failure.
- **`CREATE DATABASE` cannot run in a transaction.** Provisioning uses a plain
  node-postgres connection for the create/drop, and `prisma migrate deploy`
  (subprocess) for the schema. Identifiers are validated against
  `^[A-Za-z0-9_]+$` before interpolation.

---

## 7. Security concerns (the part that sells the product)

- **Credentials at rest.** Tenant connection strings are AES-256-GCM encrypted in
  the catalog; plaintext exists only transiently in process memory. The key ring
  lives in `TENANT_SECRET_KEYS` (a secrets manager in prod), never in the DB.
- **Least privilege.** The runtime tenant role (`TENANT_DB_URL_TEMPLATE`) should
  be able to read/write its own database and nothing else. The
  superuser-capable `TENANT_DB_ADMIN_URL` is used **only** for create/drop during
  provisioning and never for queries.
- **Fail closed everywhere.** No tenant in scope → no client. Unknown tenant →
  404. Unprovisioned tenant → 503. Decrypt failure → 503. Never a silent fallback
  to a shared or wrong database.
- **Single routing seam.** Exactly one function (`TenantDatabaseService.clientFor`)
  maps tenantId → database, so the isolation boundary is one auditable place.
- **Defense-in-depth retained.** `tenantId` filters and RLS remain on top of
  physical isolation; in `pool` mode they *are* the isolation.
- **Boot-time validation.** `db-per-tenant` refuses to start if any required
  secret/URL is missing, so a misconfigured deploy can't route data somewhere
  unexpected.
- **Web/edge.** Slugs are validated against a strict regex; reserved subdomains
  can't be hijacked as tenants; the tenant header is stripped from inbound
  requests and re-set by middleware so a client can't forge `x-tenant-slug`.

---

## 8. Testing checklist

Connection-secret crypto (pure, unit):
- [x] round-trips plaintext
- [x] ciphertext never contains the plaintext
- [x] tampered ciphertext fails authentication
- [x] value encrypted under an old key still decrypts while the key is in the ring
- [x] dropping an in-use key fails loudly (no silent data loss)
- [x] wrong key fails

Connection registry (pure, unit):
- [x] caps at `maxClients`, evicting least-recently-used
- [x] touching a client makes it most-recently-used
- [x] cache hits don't rebuild
- [x] concurrent misses build exactly one client
- [x] idle sweep disconnects + evicts
- [x] invalidate disconnects + removes

Web navigation (pure, unit — see matrix in repo):
- [x] subdomain authoritative over cookie
- [x] apex clears stale cookie (the reported bug)
- [x] `/t/<slug>` routing + rewrite
- [x] query fallback; reserved subdomain ignored; invalid slug rejected
- [x] host wins over conflicting path; custom domain flagged

Integration (requires databases — to add in CI):
- [ ] provision a tenant DB end-to-end, then read/write through `TENANT_DB`
- [ ] tenant A's request cannot read tenant B's rows (separate DBs)
- [ ] JWT-tenant vs host-tenant mismatch returns 403
- [ ] `migrate-all-tenants` applies a new migration to every READY tenant
- [ ] suspend → `invalidate` closes the pool; subsequent request 503s

---

## 9. Operational runbook

**Provision a new tenant** (after the `Tenant` row exists):
```ts
await tenantProvisioning.provision(tenantId); // create DB → migrate → encrypt+store → READY
```

**Ship a schema change** (db-per-tenant):
```bash
# 1) author a BACKWARD-COMPATIBLE migration
pnpm --filter @speed-enterprises/api prisma migrate dev --name <change>
# 2) deploy app code that tolerates old + new schema
# 3) fan out to every tenant DB
pnpm --filter @speed-enterprises/api exec tsx prisma/migrate-all-tenants.ts --concurrency=4
# 4) (later) contract migration to drop old columns, fan out again
```

**Rotate the encryption key ring:**
```
TENANT_SECRET_KEYS="k2:<new b64>,k1:<old b64>"   # k2 primary, k1 still decrypts
# re-encrypt at leisure, then drop k1 once nothing needs it
```

**Roll back the topology:** set `TENANCY_MODE=pool` and redeploy. Instant.

---

## 10. Tradeoffs summary

| Option | Isolation | Ops cost | When it's right |
|--------|-----------|----------|-----------------|
| Shared DB + tenantId + RLS (`pool`) | Logical | Lowest | Early stage, low compliance bar |
| **DB per tenant, one schema, N connections (chosen)** | **Physical** | **Medium** | **Selling isolation to SMBs; per-tenant backup/residency** |
| DB per tenant, two generated clients | Physical + compile-time | Medium-high | When you want the type system to forbid cross-plane access |
| Schema-per-tenant (one DB, N schemas) | Medium | Medium | Many tiny tenants, one server, softer isolation |

We chose row 2: it delivers the physical isolation you're selling with the
smallest blast radius to the existing codebase, and it leaves row 3 as a clean
future upgrade if you want compile-time guarantees too.
