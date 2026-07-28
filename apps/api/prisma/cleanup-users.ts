/**
 * One-off DB maintenance: prune customer-type users.
 *
 *   pnpm --filter @speed-enterprises/api db:cleanup-users           # dry run (prints plan, changes nothing)
 *   pnpm --filter @speed-enterprises/api db:cleanup-users -- --apply  # execute
 *
 * What it does:
 *  1. Asserts the two named owner accounts hold an active OWNER membership on
 *     their tenant. (There is no platform-level "owner" type — PlatformRole is
 *     only CUSTOMER | PLATFORM_ADMIN; "owner" is the tenant membership role.)
 *  2. HARD-deletes every user whose memberships are all tenant-role CUSTOMER
 *     (or who has none), except the keep-list below and platform admins.
 *     Staff/admin/owner users of any tenant are untouched.
 *
 * Deletion side effects (verified against schema referential actions):
 *  - QuoteStatusHistory rows authored by deleted users are removed first
 *    (changedById is a required FK with RESTRICT — deletion would fail otherwise).
 *  - Quotes survive: QuoteRequest.userId is an optional relation → SET NULL;
 *    the quote keeps its guest name/email snapshot.
 *  - Memberships, customer profiles, refresh/verification tokens, appointments,
 *    audit-log links CASCADE.
 *
 * NOTE: written for the dev setup where catalog + tenant data share one
 * database (the same assumption every seed in this folder makes). Do not run
 * against a production multi-database deployment without routing through
 * TenantDatabaseService.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Users kept no matter what (asserted as tenant OWNERs of their business). */
const KEEP_OWNERS: Array<{ email: string; tenantSlug: string }> = [
  { email: 'owner@speedenterprises.com',  tenantSlug: 'speedenterprises' },
  { email: 'owner@acmeplumbing.example',  tenantSlug: 'acme-plumbing' },
];

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '── APPLY MODE ──' : '── DRY RUN (pass --apply to execute) ──');

  // 1) Assert OWNER membership for the keep-list.
  for (const { email, tenantSlug } of KEEP_OWNERS) {
    const user = await prisma.user.findUnique({ where: { email } });
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!user || !tenant) {
      console.warn(`! ${email} / ${tenantSlug}: ${!user ? 'user' : 'tenant'} not found — skipping assert`);
      continue;
    }
    const m = await prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    });
    if (!m) {
      console.log(`+ ${email}: no membership on ${tenantSlug} — will create as OWNER`);
      if (apply) {
        await prisma.tenantMembership.create({
          data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', acceptedAt: new Date() },
        });
      }
    } else if (m.role !== 'OWNER' || !m.active) {
      console.log(`~ ${email}: membership ${m.role}/${m.active ? 'active' : 'inactive'} — will set OWNER/active`);
      if (apply) {
        await prisma.tenantMembership.update({ where: { id: m.id }, data: { role: 'OWNER', active: true } });
      }
    } else {
      console.log(`✓ ${email}: already active OWNER of ${tenantSlug}`);
    }
  }

  // 2) Victims: platform-role CUSTOMER users with no STAFF/ADMIN/OWNER
  //    membership anywhere, excluding the keep-list. Platform admins are
  //    excluded by the platformRole filter.
  const victims = await prisma.user.findMany({
    where: {
      platformRole: 'CUSTOMER',
      email: { notIn: KEEP_OWNERS.map(k => k.email) },
      memberships: { none: { role: { in: ['STAFF', 'OWNER'] } } },
    },
    select: { id: true, email: true, _count: { select: { quoteRequests: true, statusChanges: true } } },
    orderBy: { email: 'asc' },
  });

  if (victims.length === 0) {
    console.log('Nothing to delete — no tenant-role-customer users found.');
    return;
  }

  console.log(`\n${victims.length} customer user(s) to delete:`);
  for (const v of victims) {
    console.log(`  - ${v.email}  (quotes linked: ${v._count.quoteRequests}, status changes: ${v._count.statusChanges})`);
  }
  console.log('  (their quotes are kept and unlinked; their status-history rows are removed)');

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to execute.');
    return;
  }

  const ids = victims.map(v => v.id);
  // Order matters: status history first (required FK, RESTRICT), then users
  // (everything else cascades or nulls per schema).
  const [hist, users] = await prisma.$transaction([
    prisma.quoteStatusHistory.deleteMany({ where: { changedById: { in: ids } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`\nDeleted ${users.count} user(s) and ${hist.count} status-history row(s).`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
