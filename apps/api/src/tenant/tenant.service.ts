import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { CatalogPrismaService } from '../database/catalog-prisma.service';

/**
 * Resolves and caches tenants by slug or custom domain. Cache TTL is
 * intentionally small (60s) so config edits propagate quickly.
 *
 * The Tenant registry is control-plane data, so this reads the CATALOG client
 * (which equals the shared DB in pool mode). It must NOT use a per-tenant client
 * — it runs during tenant resolution, before any tenant is established.
 */
@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);
  private cache = new Map<string, { value: ResolvedTenant; expiresAt: number }>();
  private readonly TTL_MS = 60_000;

  constructor(private prisma: CatalogPrismaService) {}

  /** Find a tenant by slug. Returns null if not found. */
  async findBySlug(slug: string): Promise<ResolvedTenant | null> {
    const key = `slug:${slug}`;
    const cached = this.read(key);
    if (cached !== undefined) return cached;

    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true, industry: true, config: { select: { businessName: true } } },
    });
    if (!t) {
      this.write(key, null);
      return null;
    }
    const resolved: ResolvedTenant = {
      id:           t.id,
      slug:         t.slug,
      status:       t.status,
      industry:     t.industry,
      businessName: t.config?.businessName ?? t.slug,
    };
    this.write(key, resolved);
    return resolved;
  }

  async findById(id: string): Promise<ResolvedTenant | null> {
    const key = `id:${id}`;
    const cached = this.read(key);
    if (cached !== undefined) return cached;

    const t = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, slug: true, status: true, industry: true, config: { select: { businessName: true } } },
    });
    const resolved = t ? {
      id: t.id, slug: t.slug, status: t.status, industry: t.industry,
      businessName: t.config?.businessName ?? t.slug,
    } : null;
    this.write(key, resolved);
    return resolved;
  }

  async findByCustomDomain(domain: string): Promise<ResolvedTenant | null> {
    const key = `domain:${domain}`;
    const cached = this.read(key);
    if (cached !== undefined) return cached;

    const t = await this.prisma.tenant.findUnique({
      where: { customDomain: domain },
      select: { id: true, slug: true, status: true, industry: true, config: { select: { businessName: true } } },
    });
    const resolved = t ? {
      id: t.id, slug: t.slug, status: t.status, industry: t.industry,
      businessName: t.config?.businessName ?? t.slug,
    } : null;
    this.write(key, resolved);
    return resolved;
  }

  async requireBySlug(slug: string): Promise<ResolvedTenant> {
    const t = await this.findBySlug(slug);
    if (!t) throw new NotFoundException(`Unknown tenant: ${slug}`);
    return t;
  }

  invalidate(tenantId: string, slug?: string) {
    this.cache.delete(`id:${tenantId}`);
    if (slug) this.cache.delete(`slug:${slug}`);
    // Custom domain entries get GC'd on TTL; not critical
  }

  // ── cache primitives ─────────────────────────────────
  private read(key: string): ResolvedTenant | null | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return hit.value;
  }

  private write(key: string, value: ResolvedTenant | null) {
    // Cap cache size; simple LRU-ish eviction
    if (this.cache.size > 1000) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    if (value) this.cache.set(key, { value, expiresAt: Date.now() + this.TTL_MS });
  }
}

export interface ResolvedTenant {
  id: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | 'TRIAL';
  industry: string;
  businessName: string;
}
