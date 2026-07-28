import { CatalogPrismaService } from './catalog-prisma.service';

/**
 * Application-level joins across the catalog/tenant database boundary.
 *
 * In db-per-tenant mode a tenant row (e.g. QuoteRequest) and the identity row it
 * references (User, in the catalog DB) live in DIFFERENT databases, so Prisma's
 * `include` can't join them. Instead: fetch tenant rows from the tenant client,
 * collect the foreign ids, batch-load the catalog rows once, and stitch them in.
 * One extra query per relation — N+1-safe.
 *
 * Example (replacing `include: { user: { select: { email } } }`):
 *
 *   const quotes = await tenantDb.quoteRequest.findMany({ where: { ... } });
 *   const withUsers = await hydrate(quotes, {
 *     keyOf: (q) => q.userId,
 *     as: 'user',
 *     load: (ids) => loadUsersByIds(catalog, ids, { email: true }),
 *   });
 *   // withUsers[i].user is { email } | null
 */
export async function hydrate<T, K extends string, V>(
  rows: T[],
  opts: {
    /** Foreign key on each row (e.g. row.userId). Null/undefined → no match. */
    keyOf: (row: T) => string | null | undefined;
    /** Batch-load the related rows by id, returning a Map keyed by id. */
    load: (ids: string[]) => Promise<Map<string, V>>;
    /** Property name to attach the loaded value under. */
    as: K;
  },
): Promise<Array<T & { [P in K]: V | null }>> {
  const ids = Array.from(
    new Set(rows.map(opts.keyOf).filter((id): id is string => typeof id === 'string' && id.length > 0)),
  );
  const map = ids.length ? await opts.load(ids) : new Map<string, V>();
  return rows.map((row) => {
    const id = opts.keyOf(row);
    return { ...row, [opts.as]: id ? map.get(id) ?? null : null } as T & { [P in K]: V | null };
  });
}

/** Batch-load catalog Users by id into a Map. `select` defaults to id+email. */
export async function loadUsersByIds<S extends Record<string, boolean>>(
  catalog: CatalogPrismaService,
  ids: string[],
  select: S = { id: true, email: true } as unknown as S,
): Promise<Map<string, any>> {
  if (!ids.length) return new Map();
  const users = await catalog.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, ...select },
  });
  return new Map(users.map((u: any) => [u.id, u]));
}

/** Batch-load catalog TenantMemberships by id into a Map (for time/routes). */
export async function loadMembershipsByIds(
  catalog: CatalogPrismaService,
  ids: string[],
): Promise<Map<string, any>> {
  if (!ids.length) return new Map();
  const rows = await catalog.tenantMembership.findMany({
    where: { id: { in: ids } },
    select: { id: true, userId: true, role: true, fullName: true, title: true, active: true },
  });
  return new Map(rows.map((m: any) => [m.id, m]));
}
