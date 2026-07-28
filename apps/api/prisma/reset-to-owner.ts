/**
 * Resets the Speed Enterprises tenant to a clean slate: the only users left are
 * the business owner and any platform admin. All other accounts and every piece
 * of tenant operational data are removed so the web + mobile UIs show an empty,
 * real-data-only database.
 *
 *   pnpm --filter @speed-enterprises/api db:reset-to-owner            # dry run
 *   pnpm --filter @speed-enterprises/api db:reset-to-owner -- --apply # execute
 *
 * Kept: owner@speedenterprises.com (tenant OWNER) and every PLATFORM_ADMIN user.
 * Deleted: all other users (cascades their memberships, profiles and tokens) and
 * the tenant's quotes, line items, status history, appointments, uploaded images,
 * work routes, time entries, route templates and audit logs. EmailLog /
 * EmailSuppression are left as-is — they are not surfaced in any UI.
 *
 * Pool-mode only (catalog + tenant share one database).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_SLUG = 'speedenterprises';
/** Business logins that survive. Platform admins are kept via platformRole. */
const KEEP_EMAILS = ['owner@speedenterprises.com'];

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '── APPLY MODE ──' : '── DRY RUN (pass --apply to execute) ──');

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) { console.error(`Tenant '${TENANT_SLUG}' not found.`); process.exit(1); }
  const tenantId = tenant.id;

  // Keep-list: the owner plus every platform admin.
  const platformAdmins = await prisma.user.findMany({
    where: { platformRole: 'PLATFORM_ADMIN' }, select: { id: true, email: true },
  });
  const keepIds = new Set<string>(platformAdmins.map(a => a.id));
  for (const email of KEEP_EMAILS) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (u) keepIds.add(u.id);
    else console.warn(`! keep-list email not found (skipping): ${email}`);
  }

  // Confirm the owner is still an active OWNER of the tenant.
  const owner = await prisma.user.findUnique({ where: { email: KEEP_EMAILS[0]! }, select: { id: true } });
  if (owner) {
    const m = await prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: owner.id, tenantId } },
    });
    if (!m || m.role !== 'OWNER' || !m.active) {
      console.warn(`! ${KEEP_EMAILS[0]} is not an active OWNER of ${TENANT_SLUG} (role=${m?.role ?? 'none'}, active=${m?.active ?? false})`);
    } else {
      console.log(`✓ owner verified: ${KEEP_EMAILS[0]} (active OWNER of ${TENANT_SLUG})`);
    }
  }

  const victims = await prisma.user.findMany({
    where: { id: { notIn: [...keepIds] }, platformRole: { not: 'PLATFORM_ADMIN' } },
    select: { id: true, email: true },
    orderBy: { email: 'asc' },
  });

  const [appts, history, lineItems, images, quotes, routes, timeEntries, templates, audits] = await Promise.all([
    prisma.appointment.count({ where: { tenantId } }),
    prisma.quoteStatusHistory.count({ where: { tenantId } }),
    prisma.quoteLineItem.count({ where: { tenantId } }),
    prisma.uploadedImage.count({ where: { tenantId } }),
    prisma.quoteRequest.count({ where: { tenantId } }),
    prisma.workRoute.count({ where: { tenantId } }),
    prisma.timeEntry.count({ where: { tenantId } }),
    prisma.routeTemplate.count({ where: { tenantId } }),
    prisma.auditLog.count({ where: { tenantId } }),
  ]);

  console.log(`\nKeeping ${keepIds.size} user(s): ${KEEP_EMAILS.join(', ')}` +
    (platformAdmins.length ? ` + platform admin(s): ${platformAdmins.map(a => a.email).join(', ')}` : ''));
  console.log(`\nWill DELETE ${victims.length} user(s):`);
  for (const v of victims) console.log(`  - ${v.email}`);
  console.log(`\nWill DELETE tenant '${TENANT_SLUG}' operational data:`);
  console.log(`  Appointments ......... ${appts}`);
  console.log(`  Quote status history . ${history}`);
  console.log(`  Quote line items ..... ${lineItems}`);
  console.log(`  Uploaded images ...... ${images}`);
  console.log(`  Quote requests ....... ${quotes}`);
  console.log(`  Work routes .......... ${routes}  (+ stops/assignees/waypoints)`);
  console.log(`  Time entries ......... ${timeEntries}`);
  console.log(`  Route templates ...... ${templates}  (+ stops/assignees)`);
  console.log(`  Audit logs ........... ${audits}`);

  if (!apply) { console.log('\nDry run complete. Re-run with --apply to execute.'); return; }

  const victimIds = victims.map(v => v.id);
  // Appointment.quoteRequest and QuoteStatusHistory.changedById are RESTRICT FKs,
  // so appointments precede quotes and status history precedes users; the rest
  // cascade or set null per schema.
  await prisma.$transaction([
    prisma.appointment.deleteMany({ where: { tenantId } }),
    prisma.quoteStatusHistory.deleteMany({ where: { tenantId } }),
    prisma.quoteLineItem.deleteMany({ where: { tenantId } }),
    prisma.uploadedImage.deleteMany({ where: { tenantId } }),
    prisma.quoteRequest.deleteMany({ where: { tenantId } }),
    prisma.workRoute.deleteMany({ where: { tenantId } }),
    prisma.timeEntry.deleteMany({ where: { tenantId } }),
    prisma.routeTemplate.deleteMany({ where: { tenantId } }),
    prisma.auditLog.deleteMany({ where: { tenantId } }),
    prisma.user.deleteMany({ where: { id: { in: victimIds } } }),
  ]);

  console.log(`\n✓ Deleted ${victims.length} user(s) and all tenant operational data. Clean slate.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
