/**
 * Gives each seeded @example.com customer one quote so the owner has data to
 * view: 20 QuoteRequests spread across every status, with realistic timestamps,
 * a status-history trail (authored by the owner) and line items on finished
 * jobs. The service address is copied from each customer's CustomerProfile.
 *
 *   pnpm --filter @speed-enterprises/api db:seed-quotes
 *
 * Standalone and opt-in; not part of the default `pnpm seed`. Re-running first
 * clears the existing quotes for these customers, so the count stays at 20.
 * Run db:seed-customers first if the customers don't exist yet.
 */
import { PrismaClient, QuoteStatus, PropertyKind, AuditAction } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_SLUG = 'speedenterprises';
const CUSTOMER_DOMAIN = '@example.com';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;

/** Roughly how many days ago a quote in each status was created. */
const STATUS_AGE: Record<QuoteStatus, number> = {
  NEW: 0, REVIEWING: 1, ESTIMATE_SENT: 3, SCHEDULED: 6,
  IN_PROGRESS: 7, COMPLETED: 12, PAID: 16, CANCELED: 8,
};

/** Lifecycle order used to build the status-history trail. */
const CHAIN: QuoteStatus[] = ['NEW', 'REVIEWING', 'ESTIMATE_SENT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'PAID'];

/** 20 statuses: one of each, then a realistic mix for the remaining twelve. */
const STATUSES: QuoteStatus[] = [
  'NEW', 'REVIEWING', 'ESTIMATE_SENT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'PAID', 'CANCELED',
  'NEW', 'NEW', 'REVIEWING', 'ESTIMATE_SENT', 'ESTIMATE_SENT', 'SCHEDULED',
  'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED', 'PAID', 'REVIEWING',
];

const ESTIMATES = [14900, 19900, 24900, 29900, 39900, 49900, 59900, 89900, 119900, 149900];

const has = (s: QuoteStatus, set: QuoteStatus[]) => set.includes(s);

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) { console.error(`Tenant '${TENANT_SLUG}' not found — run the base seed first.`); process.exit(1); }

  const owner = await prisma.tenantMembership.findFirst({
    where: { tenantId: tenant.id, role: 'OWNER', active: true },
    select: { userId: true },
  });
  if (!owner) { console.error('No active OWNER found on the tenant.'); process.exit(1); }

  const services = await prisma.service.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
  if (services.length === 0) { console.error('No services on the tenant — run the base seed first.'); process.exit(1); }

  const customers = await prisma.tenantMembership.findMany({
    where: { tenantId: tenant.id, role: 'CUSTOMER', user: { email: { endsWith: CUSTOMER_DOMAIN } } },
    include: {
      user: { select: { id: true, email: true } },
      // profiles are keyed by (userId, tenantId); fetched separately below.
    },
    orderBy: { createdAt: 'asc' },
  });
  if (customers.length === 0) { console.error(`No ${CUSTOMER_DOMAIN} customers — run db:seed-customers first.`); process.exit(1); }

  const profiles = await prisma.customerProfile.findMany({
    where: { tenantId: tenant.id, userId: { in: customers.map(c => c.userId) } },
  });
  const profileByUser = new Map(profiles.map(p => [p.userId, p]));

  // Clear any prior quotes for these customers so re-runs stay at 20
  // (status history + line items cascade on quote delete).
  const cleared = await prisma.quoteRequest.deleteMany({
    where: { tenantId: tenant.id, userId: { in: customers.map(c => c.userId) } },
  });
  if (cleared.count) console.log(`Cleared ${cleared.count} existing quote(s) for these customers.`);

  const n = Math.min(20, customers.length);
  for (let i = 0; i < n; i++) {
    const cust = customers[i]!;
    const status = STATUSES[i]!;
    const profile = profileByUser.get(cust.userId);
    const svc = pick(services);
    const kind: PropertyKind = i % 3 === 0 ? 'COMMERCIAL' : 'RESIDENTIAL';
    const createdAt = daysAgo(STATUS_AGE[status] + Math.floor(Math.random() * 4) + 1);

    const hasEstimate = has(status, ['ESTIMATE_SENT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'PAID']);
    const est = hasEstimate ? pick(ESTIMATES) : null;

    const quote = await prisma.quoteRequest.create({
      data: {
        tenantId:    tenant.id,
        userId:      cust.userId,
        serviceId:   svc.id,
        propertyKind: kind,
        status,
        addressLine: profile?.addressLine ?? '100 Main St',
        city:        profile?.city ?? 'Salt Lake City',
        state:       profile?.state ?? 'UT',
        postalCode:  profile?.postalCode ?? '84101',
        estimateAmountCents: est,
        estimateSentAt: hasEstimate ? daysAgo(STATUS_AGE[status] - 1) : null,
        acceptedAt:  has(status, ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'PAID']) ? daysAgo(STATUS_AGE[status] - 2) : null,
        scheduledAt: has(status, ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'PAID']) ? daysAgo(STATUS_AGE[status] - 3) : null,
        startedAt:   has(status, ['IN_PROGRESS', 'COMPLETED', 'PAID']) ? daysAgo(STATUS_AGE[status] - 4) : null,
        completedAt: has(status, ['COMPLETED', 'PAID']) ? daysAgo(STATUS_AGE[status] - 5) : null,
        paidAt:      status === 'PAID' ? daysAgo(STATUS_AGE[status] - 6) : null,
        customerNotes: i % 4 === 0 ? 'Please call 30 minutes before arrival.' : i % 5 === 0 ? 'Gate code is 1234. Friendly dog in the yard.' : null,
        internalNotes: i % 3 === 0 ? 'Repeat customer — priority scheduling.' : null,
        answers: {},
        source: 'web',
        createdAt,
      },
    });

    // Status-history trail up to the current status (owner as the actor).
    if (status === 'CANCELED') {
      await prisma.quoteStatusHistory.create({
        data: { tenantId: tenant.id, quoteRequestId: quote.id, fromStatus: 'NEW', toStatus: 'CANCELED', changedById: owner.userId, note: 'Customer canceled the request.', createdAt: daysAgo(STATUS_AGE.CANCELED - 1) },
      });
    } else {
      const upto = CHAIN.indexOf(status);
      for (let s = 0; s < upto; s++) {
        await prisma.quoteStatusHistory.create({
          data: {
            tenantId: tenant.id, quoteRequestId: quote.id,
            fromStatus: CHAIN[s]!, toStatus: CHAIN[s + 1]!,
            changedById: owner.userId,
            note: s === 1 ? 'Estimate prepared after review.' : s === 2 ? 'Customer accepted the estimate.' : null,
            createdAt: new Date(createdAt.getTime() + (s + 1) * 12 * 3_600_000),
          },
        });
      }
    }

    // Line items on finished jobs.
    if (has(status, ['COMPLETED', 'PAID']) && est) {
      await prisma.quoteLineItem.createMany({
        data: [
          { tenantId: tenant.id, quoteRequestId: quote.id, kind: 'window', quantity: pick([6, 8, 12, 16, 24]), unitPriceCents: pick([1500, 2000, 2500]), payload: { windowType: 'standard', size: 'medium' }, source: 'manual', isEstimated: false },
          { tenantId: tenant.id, quoteRequestId: quote.id, kind: 'screen', quantity: pick([4, 6, 8]), unitPriceCents: 500, payload: { screenSize: 'standard' }, source: 'manual', isEstimated: false },
        ],
      });
    }
  }

  await prisma.auditLog.create({
    data: { tenantId: tenant.id, actorUserId: owner.userId, action: AuditAction.QUOTE_CREATED, entityType: 'QuoteRequest', entityId: 'seed-quotes', metadata: { seeded: n } as any },
  });

  console.log(`✓ Seeded ${n} quotes across all statuses for ${CUSTOMER_DOMAIN} customers on '${TENANT_SLUG}'.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
