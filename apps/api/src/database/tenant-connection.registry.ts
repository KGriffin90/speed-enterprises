/**
 * TenantConnectionRegistry
 * ────────────────────────
 * Owns one Postgres connection pool *per tenant database* and hands the right
 * client to each request. In a database-per-tenant topology this is the single
 * most important — and most dangerous — piece of infrastructure:
 *
 *   • If we open a brand-new PrismaClient on every request we leak connections
 *     and melt Postgres (each client keeps its own pool).
 *   • If we keep a client for every tenant forever we run out of file handles /
 *     Postgres `max_connections` once we have thousands of tenants.
 *
 * So we keep a *bounded LRU cache* of live clients: hot tenants stay connected,
 * cold tenants get disconnected and evicted. A tenant that comes back simply
 * gets a fresh client. Capacity and idle TTL are tunable.
 *
 * This class is intentionally framework-agnostic and generic over the client
 * type so it can be unit-tested with a fake factory (no real database needed).
 * The NestJS-flavored wrapper lives in tenant-database.service.ts.
 */

export interface Disconnectable {
  $disconnect(): Promise<void>;
}

export interface RegistryOptions<C extends Disconnectable> {
  /** Max number of simultaneously-open tenant clients. */
  maxClients: number;
  /** Evict a client after it has been idle this long (ms). 0 disables idle eviction. */
  idleTtlMs: number;
  /** Build a client for a resolved connection URL. */
  factory: (connectionUrl: string, tenantId: string) => C;
  /** Optional hook for metrics/logging on eviction. */
  onEvict?: (tenantId: string, reason: 'lru' | 'idle' | 'shutdown' | 'invalidate') => void;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}

interface Entry<C> {
  client: C;
  lastUsedAt: number;
  /** In-flight construction promise, deduped so concurrent requests share one client. */
  building?: Promise<C>;
}

export class TenantConnectionRegistry<C extends Disconnectable> {
  private readonly entries = new Map<string, Entry<C>>();
  private readonly now: () => number;

  constructor(private readonly opts: RegistryOptions<C>) {
    if (opts.maxClients < 1) throw new Error('maxClients must be >= 1');
    this.now = opts.now ?? Date.now;
  }

  /**
   * Get (or lazily open) the client for `tenantId`. `resolveUrl` is only called
   * on a cache miss, so the expensive catalog lookup + decrypt happens once per
   * cold tenant, not once per request.
   *
   * Concurrency: if two requests miss simultaneously we build exactly one
   * client and both await the same promise.
   */
  async acquire(tenantId: string, resolveUrl: () => Promise<string>): Promise<C> {
    const existing = this.entries.get(tenantId);
    if (existing) {
      if (existing.building) return existing.building;
      existing.lastUsedAt = this.now();
      // Touch = move to most-recently-used position (Map preserves insertion order).
      this.entries.delete(tenantId);
      this.entries.set(tenantId, existing);
      return existing.client;
    }

    const entry: Entry<C> = { client: undefined as unknown as C, lastUsedAt: this.now() };
    const building = (async () => {
      const url = await resolveUrl();
      const client = this.opts.factory(url, tenantId);
      entry.client = client;
      entry.building = undefined;
      entry.lastUsedAt = this.now();
      return client;
    })();
    entry.building = building;
    this.entries.set(tenantId, entry);

    try {
      const client = await building;
      this.evictIfOverCapacity(tenantId);
      return client;
    } catch (err) {
      // Construction failed — don't leave a poisoned entry behind.
      this.entries.delete(tenantId);
      throw err;
    }
  }

  /** Drop a tenant's client immediately (e.g. tenant suspended, creds rotated). */
  async invalidate(tenantId: string): Promise<void> {
    const entry = this.entries.get(tenantId);
    if (!entry) return;
    this.entries.delete(tenantId);
    this.opts.onEvict?.(tenantId, 'invalidate');
    if (entry.client) await safeDisconnect(entry.client);
  }

  /** Sweep idle clients. Call on a timer (e.g. every 60s). */
  async sweepIdle(): Promise<void> {
    if (this.opts.idleTtlMs <= 0) return;
    const cutoff = this.now() - this.opts.idleTtlMs;
    const stale: string[] = [];
    for (const [tenantId, entry] of this.entries) {
      if (!entry.building && entry.lastUsedAt < cutoff) stale.push(tenantId);
    }
    for (const tenantId of stale) {
      const entry = this.entries.get(tenantId);
      if (!entry) continue;
      this.entries.delete(tenantId);
      this.opts.onEvict?.(tenantId, 'idle');
      if (entry.client) await safeDisconnect(entry.client);
    }
  }

  /** Disconnect everything on app shutdown. */
  async shutdown(): Promise<void> {
    const all = [...this.entries.entries()];
    this.entries.clear();
    await Promise.all(
      all.map(async ([tenantId, entry]) => {
        this.opts.onEvict?.(tenantId, 'shutdown');
        if (entry.client) await safeDisconnect(entry.client);
      }),
    );
  }

  get size(): number {
    return this.entries.size;
  }

  /** Evict least-recently-used clients until we're at/under capacity. */
  private evictIfOverCapacity(keep: string): void {
    while (this.entries.size > this.opts.maxClients) {
      // Oldest = first key in insertion order that isn't the one we just touched.
      let victim: string | undefined;
      for (const key of this.entries.keys()) {
        if (key !== keep) {
          victim = key;
          break;
        }
      }
      if (!victim) break;
      const entry = this.entries.get(victim)!;
      this.entries.delete(victim);
      this.opts.onEvict?.(victim, 'lru');
      // Fire-and-forget disconnect; we don't want eviction to block the request.
      if (entry.client) void safeDisconnect(entry.client);
    }
  }
}

async function safeDisconnect(client: Disconnectable): Promise<void> {
  try {
    await client.$disconnect();
  } catch {
    // Already closing / network gone — nothing actionable.
  }
}
