/**
 * Set the Speed Enterprises tenant's public services + their two-category
 * grouping. Idempotent / re-runnable.
 *
 *   pnpm --filter @speed-enterprises/api exec tsx prisma/update-speed-services.ts
 *
 * Structure (the storefront groups by category — RESIDENTIAL shows under
 * "Residential", COMMERCIAL under "Commercial", BOTH under both):
 *
 *   Residential : Residential Window Cleaning, Residential Pressure Washing
 *   Commercial  : Commercial Window Cleaning, Commercial Pressure Washing
 *
 * Screen Cleaning & Restoration and Track Cleaning were retired as standalone
 * services — they're now "Include screens?" / "Include window track cleaning?"
 * options inside the Residential Window Cleaning quote. They (plus "Exterior
 * Window Washing" and the generic "Window Cleaning") are hidden from the public
 * site (kept in the DB, not deleted). Existing services' quote `questions`/
 * pricing are preserved (update only touches copy/category/icon/order/visibility).
 */
import { PrismaClient, ServiceCategory, PricingMode } from '@prisma/client';

const TENANT_SLUG = 'speedenterprises';

// Public services, in display order (sortOrder). Each is upserted; the update
// path only writes `questions` for entries that define them (the window-cleaning
// services omit it, so their template questions + COMPUTED pricing survive).
interface VisibleService {
  slug: string; name: string; category: ServiceCategory; iconKey: string;
  sortOrder: number; description: string; questions?: unknown[];
}
const VISIBLE: VisibleService[] = [
  {
    slug: 'residential-window-cleaning', name: 'Residential Window Cleaning',
    category: ServiceCategory.RESIDENTIAL, iconKey: 'home', sortOrder: 0,
    description:
      'Keep your home bright and beautiful with our professional residential window cleaning. We remove dirt, hard water stains, and grime to deliver crystal-clear windows that boost curb appeal and let natural light flood your living spaces.',
  },
  {
    slug: 'commercial-window-cleaning', name: 'Commercial Window Cleaning',
    category: ServiceCategory.COMMERCIAL, iconKey: 'building', sortOrder: 1,
    description:
      'First impressions matter. Our commercial window cleaning services keep storefronts, offices, and multi-story buildings spotless and professional — scheduled around your business hours with minimal disruption.',
  },
  // Screen Cleaning & Restoration and Track Cleaning were retired as standalone
  // services — "Include screens?" and "Include window track cleaning?" are now
  // options inside the Residential Window Cleaning quote instead (see HIDE).
  {
    slug: 'residential-pressure-washing', name: 'Residential Pressure Washing',
    category: ServiceCategory.RESIDENTIAL, iconKey: 'washing', sortOrder: 2,
    description:
      "Blast away dirt, mildew, and grime from driveways, siding, patios, decks, and walkways. Our professional pressure washing restores surfaces to like-new condition and dramatically boosts your home's curb appeal.",
    // Real questions so both web and mobile show the same sensible form (these
    // services previously had none, so web fell back to window-cleaning Qs).
    questions: [
      { id: 'surfaces', label: 'What surfaces need pressure washing?', type: 'multiselect', required: true, options: [
        { value: 'driveway', label: 'Driveway' },
        { value: 'sidewalk', label: 'Sidewalk / walkway' },
        { value: 'patio',    label: 'Patio' },
        { value: 'deck',     label: 'Deck' },
        { value: 'siding',   label: 'House siding / exterior walls' },
        { value: 'fence',    label: 'Fence' },
        { value: 'roof',     label: 'Roof' },
        { value: 'other',    label: 'Other' },
      ] },
      { id: 'approx_area', label: 'Approximate area to clean', type: 'number', required: false, min: 1, max: 100000, unit: 'sq ft' },
      { id: 'stories', label: 'How many stories (for siding / house washing)?', type: 'select', required: false, options: [
        { value: '1', label: '1 story' }, { value: '2', label: '2 stories' }, { value: '3+', label: '3+ stories' },
      ] },
      { id: 'photos', label: 'Photos of the areas (optional)', type: 'photo', required: false, maxFiles: 6 },
    ],
  },
  {
    slug: 'commercial-pressure-washing', name: 'Commercial Pressure Washing',
    category: ServiceCategory.COMMERCIAL, iconKey: 'washing', sortOrder: 3,
    description:
      'Keep your commercial property pristine. Our pressure washing strips dirt, grime, gum, and stains from storefronts, sidewalks, entryways, and building exteriors — protecting your investment and making a strong first impression on every customer.',
    questions: [
      { id: 'surfaces', label: 'What surfaces need pressure washing?', type: 'multiselect', required: true, options: [
        { value: 'building',   label: 'Building exterior' },
        { value: 'sidewalks',  label: 'Sidewalks / walkways' },
        { value: 'parking',    label: 'Parking lot / garage' },
        { value: 'drive_thru', label: 'Drive-thru' },
        { value: 'dumpster',   label: 'Dumpster area' },
        { value: 'storefront', label: 'Storefront / entryway' },
        { value: 'other',      label: 'Other' },
      ] },
      { id: 'approx_area', label: 'Approximate area to clean', type: 'number', required: false, min: 1, max: 1000000, unit: 'sq ft' },
      { id: 'frequency', label: 'How often?', type: 'select', required: true, options: [
        { value: 'one_time',  label: 'One-time' },
        { value: 'weekly',    label: 'Weekly' },
        { value: 'monthly',   label: 'Monthly' },
        { value: 'quarterly', label: 'Quarterly' },
      ] },
      { id: 'photos', label: 'Photos of the property (optional)', type: 'photo', required: false, maxFiles: 8 },
    ],
  },
];

// Removed from the public list (kept in the DB so existing quotes stay valid,
// just hidden from the storefront). Screen + track cleaning are now options
// inside the Residential Window Cleaning quote rather than standalone services.
const HIDE = [
  'exterior-window-washing', 'window-cleaning',
  'screen-cleaning-restoration', 'track-cleaning', 'pressure-washing',
  'residential-screen-cleaning', 'residential-track-cleaning',
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: TENANT_SLUG } });
    const tenantId = tenant.id;

    for (const s of VISIBLE) {
      await prisma.service.upsert({
        where: { tenantId_slug: { tenantId, slug: s.slug } },
        update: {
          name: s.name, category: s.category, description: s.description,
          iconKey: s.iconKey, sortOrder: s.sortOrder,
          visibleOnPublicSite: true, active: true,
          // Only overwrite questions for entries that define them (pressure
          // washing); window-cleaning entries omit it to keep their template Qs.
          ...(s.questions ? { questions: s.questions as any } : {}),
        },
        create: {
          tenantId, slug: s.slug, name: s.name, category: s.category,
          description: s.description, iconKey: s.iconKey, sortOrder: s.sortOrder,
          pricingMode: PricingMode.QUOTE_REQUIRED, basePriceCents: 0,
          questions: (s.questions ?? []) as any, pricingRules: [],
          visibleOnPublicSite: true, active: true,
        },
      });
      console.log(`visible  ${s.slug} [${s.category}]`);
    }

    const hidden = await prisma.service.updateMany({
      where: { tenantId, slug: { in: HIDE } },
      data: { visibleOnPublicSite: false },
    });
    console.log(`hid from public site: ${HIDE.join(', ')} (rows: ${hidden.count})`);

    const services = await prisma.service.findMany({
      where: { tenantId, active: true, visibleOnPublicSite: true },
      orderBy: { sortOrder: 'asc' },
      select: { sortOrder: true, name: true, category: true, slug: true },
    });
    console.log('\nPublic services now:');
    for (const v of services) console.log(`  ${v.sortOrder}. ${v.name} [${v.category}] (/quote/${v.slug})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
