import type { JSX } from 'react';
import Link from 'next/link';
import { loadTenantConfig, UnknownTenantError } from '@/lib/tenant';
import { SERVICE_ICON_MAP, servicePhoto } from '@/lib/service-icons';
import { HeroVideoRotator } from '@/components/HeroVideoRotator';
import { HeroImageRotator } from '@/components/HeroImageRotator';
import { notFound } from 'next/navigation';
import type { BusinessConfig, Service } from '@speed-enterprises/shared';

// ── Hero background image ─────────────────────────────────────────────────────
//
// Unsplash CDN photo IDs, keyed first by tenant slug then by industry.
// Using direct CDN URLs means images load in <100 ms — no generation delay.
// The gradient wash in hero-gradient (globals.css) sits on top; adjust the
// opacity there to control how strongly the photo shows through.

// All IDs below are verified free Unsplash photos — fetched and confirmed.
const SLUG_PHOTOS: Record<string, string> = {
  'speedenterprises': 'photo-1769788161278-8dc624a2d537', // man washing windows on skyscraper
};

const INDUSTRY_PHOTOS: Record<string, string> = {
  WINDOW_CLEANING:  'photo-1769788161278-8dc624a2d537',
};

function heroImageUrl(slug: string, industry: string): string {
  const id = SLUG_PHOTOS[slug] ?? INDUSTRY_PHOTOS[industry] ?? INDUSTRY_PHOTOS.OTHER ?? '';
  if (!id) return '';
  return `https://images.unsplash.com/${id}?w=1920&h=1080&auto=format&fit=crop&q=80`;
}

// Three drone-style slow-motion clips that rotate in the hero — a mountain
// mansion, a glass commercial building, and a glowing restaurant — each chosen
// to show off spotless, crystal-clear windows. License-clear CC0 stock
// (Pexels, free for commercial use, no attribution), trimmed/compressed locally.
const WINDOW_CLEANING_HERO_CLIPS = [
  '/videos/hero-mansion.mp4',
  '/videos/hero-restaurant.mp4',
  '/videos/hero-commercial.mp4',
];

// Short, muted, looping service clips served from /public/videos. Mapped by
// industry; the business can override it via Branding.heroVideoUrl. Files are
// license-clear stock (Mixkit, free for commercial use, no attribution).
const INDUSTRY_VIDEOS: Record<string, string> = {
  WINDOW_CLEANING:        '/videos/window-cleaning.mp4',
  PLUMBING:               '/videos/plumbing.mp4',
  ELECTRICAL:             '/videos/electrical.mp4',
  SOLAR:                  '/videos/solar.mp4',
  GUTTERS:                '/videos/gutters.mp4',
  SIDING:                 '/videos/siding.mp4',
  GLASS:                  '/videos/glass.mp4',
  GARAGE_DOOR:            '/videos/garage-door.mp4',
  FLOORING:               '/videos/flooring.mp4',
  CABINETS_COUNTERTOPS:   '/videos/cabinets.mp4',
  FENCING:                '/videos/fencing.mp4',
  DECK_PATIO:             '/videos/deck-patio.mp4',
  LOCKSMITH:              '/videos/locksmith.mp4',
  MOVING:                 '/videos/moving.mp4',
  JUNK_REMOVAL:           '/videos/junk-removal.mp4',
  SEPTIC:                 '/videos/septic.mp4',
  RADON:                  '/videos/radon.mp4',
  RESTORATION:            '/videos/restoration.mp4',
  INSULATION:             '/videos/insulation.mp4',
  CHIMNEY:                '/videos/chimney.mp4',
  WINDOW_TREATMENTS:      '/videos/window-treatments.mp4',
  SECURITY_SMART_HOME:    '/videos/security.mp4',
  EV_CHARGER:             '/videos/ev-charger.mp4',
  COMMERCIAL_MAINTENANCE: '/videos/commercial-maintenance.mp4',
  OTHER:                  '/videos/solar.mp4', // clean-energy clip as generic fallback
};

// Curated multi-clip hero sets, keyed first by tenant slug then by industry.
// When present these replace the single per-industry clip with a rotation.
const SLUG_VIDEO_SETS: Record<string, string[]> = {
  speedenterprises: WINDOW_CLEANING_HERO_CLIPS,
};
const INDUSTRY_VIDEO_SETS: Record<string, string[]> = {
  WINDOW_CLEANING: WINDOW_CLEANING_HERO_CLIPS,
};

// Resolve the ordered list of hero clips. A curated set (slug → industry) wins;
// otherwise fall back to the single per-industry clip wrapped in an array.
function heroVideoUrls(slug: string, industry: string): string[] {
  const set = SLUG_VIDEO_SETS[slug] ?? INDUSTRY_VIDEO_SETS[industry];
  if (set) return set;
  const single = INDUSTRY_VIDEOS[industry] ?? INDUSTRY_VIDEOS.OTHER;
  return single ? [single] : [];
}

// Aerial drone-style hero stills for window-cleaning storefronts, served from
// /public/images/hero. HeroImageRotator cross-fades between them with a slow
// zoom/pan so the rotation reads like footage rather than static photos.
const WINDOW_CLEANING_HERO_IMAGES = [
  '/images/hero/residential.webp',
  '/images/hero/commercial.webp',
  '/images/hero/restaurant.webp',
];

// Curated hero image sets, keyed first by tenant slug then by industry. When a
// set exists the storefront shows the animated stills in place of a video clip.
const SLUG_HERO_IMAGE_SETS: Record<string, string[]> = {
  speedenterprises: WINDOW_CLEANING_HERO_IMAGES,
};
const INDUSTRY_HERO_IMAGE_SETS: Record<string, string[]> = {
  WINDOW_CLEANING: WINDOW_CLEANING_HERO_IMAGES,
};

// Resolve the ordered list of hero stills (slug → industry → none).
function heroImages(slug: string, industry: string): string[] {
  return SLUG_HERO_IMAGE_SETS[slug] ?? INDUSTRY_HERO_IMAGE_SETS[industry] ?? [];
}

export default async function Home(): Promise<JSX.Element> {
  // Single-business site: middleware always resolves the Speed Enterprises tenant
  // (NEXT_PUBLIC_DEFAULT_TENANT) onto the x-tenant-slug header, so there is no
  // "pick a business" landing — we render the storefront directly.
  let cfg: BusinessConfig;
  try { cfg = await loadTenantConfig(); }
  catch (e) {
    if (e instanceof UnknownTenantError) notFound();
    throw e;
  }

  const allVisible = cfg.services.filter(s => s.visibleOnPublicSite && s.active);
  const residential = allVisible.filter(s => s.category !== 'COMMERCIAL');
  const commercial  = allVisible.filter(s => s.category !== 'RESIDENTIAL');

  const areas = cfg.contact.serviceAreas.map(a => a.label);
  // Animated hero stills, when the slug/industry has a set; these take priority
  // over the video rotation.
  const heroImageSet = heroImages(cfg.slug, cfg.industry);
  // Static hero background: the first rotation still if present, then the
  // tenant-configured photo, then a per-industry stock photo. Doubles as the
  // video poster and the reduced-motion / no-media fallback.
  const heroBg = heroImageSet[0] ?? cfg.branding.heroImageUrl ?? heroImageUrl(cfg.slug, cfg.industry);
  // Video rotation, used when there is no hero image set: a tenant override clip
  // wins, otherwise the curated rotation / a per-industry stock clip.
  const heroVideos = cfg.branding.heroVideoUrl
    ? [cfg.branding.heroVideoUrl]
    : heroVideoUrls(cfg.slug, cfg.industry);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      {/* --hero-image injects the hero photo into the CSS layer stack (globals.css);
          it's the poster + reduced-motion fallback when a hero video is present. */}
      {/* min-height fills the viewport below the 4rem sticky header so the hero
          ends at the bottom of the screen on landing (Services stays off-screen
          until the user scrolls). svh keeps it honest on mobile browser chrome. */}
      <section
        className="hero-gradient relative overflow-hidden flex items-center"
        id="home"
        style={{
          '--hero-image': `url("${heroBg}")`,
          minHeight: 'calc(100svh - 4rem)',
        } as React.CSSProperties}
      >
        {(heroImageSet.length > 0 || heroVideos.length > 0) && (
          // .hero-media is hidden under prefers-reduced-motion (globals.css), so
          // the section's washed --hero-image shows instead. Animated stills are
          // preferred; a video rotation is the fallback. The inner overlay
          // re-applies the wash on top of the media for text legibility — kept
          // heavier on the left (behind the copy) and lighter on the right so
          // the media reads clearly while the headline stays legible.
          <div className="hero-media absolute inset-0" style={{ zIndex: 0 }} aria-hidden="true">
            {heroImageSet.length > 0
              ? <HeroImageRotator sources={heroImageSet} />
              : <HeroVideoRotator sources={heroVideos} poster={heroBg} />}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(100deg, color-mix(in srgb, var(--surface-0) 82%, transparent) 0%, color-mix(in srgb, var(--surface-0) 68%, transparent) 48%, color-mix(in srgb, var(--surface-0) 44%, transparent) 100%)',
              }}
            />
          </div>
        )}
        <div className="section w-full py-16 md:py-20 relative" style={{ zIndex: 1 }}>
          <div className="max-w-2xl">
            {/* Industry badge */}
            <div className="inline-flex items-center gap-2 mb-6">
              <span className="badge">{"• Utah's choice for spotless windows."}</span>
              {cfg.scheduling.emergencyAvailable && (
                <span className="badge-accent">24/7 Emergency</span>
              )}
            </div>

            <h1
              className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight"
              style={{ color: 'var(--ink-900)' }}
            >
              {cfg.tagline ?? `${cfg.industryLabel} you can trust`}
            </h1>

            <p className="mt-5 text-lg md:text-xl leading-relaxed max-w-xl" style={{ color: 'var(--ink-500)' }}>
              Serving Salt Lake City Metro and the Wasatch front.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={'/quote/new'}
                className="btn-primary text-base px-7 py-3.5"
              >
                Get a Free Quote
              </Link>
              <a
                href={`tel:${cfg.contact.publicPhone}`}
                className="btn-secondary text-base px-7 py-3.5 flex items-center gap-2"
              >
                <span aria-hidden="true">📞</span>
                Call today!!
              </a>
            </div>

            {/* Quick trust row */}
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
              <TrustPill icon={<ShieldIcon />} label="Licensed & Insured" />
              <TrustPill icon={<StarIcon />}   label="Free Estimates" />
              <TrustPill icon={<ClockIcon />}  label={cfg.scheduling.emergencyAvailable ? '24/7 Available' : 'Fast Response'} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Services ─────────────────────────────────────────────────── */}
      <section className="section py-16 md:py-20" id="services">
        <SectionHeader
          eyebrow="What we do"
          title="Our Services"
          sub={`${allVisible.length} service${allVisible.length !== 1 ? 's' : ''} available — get a custom quote in minutes`}
        />

        {cfg.features.residentialEnabled && residential.length > 0 && (
          <ServiceGroup title="Residential" services={residential} />
        )}
        {cfg.features.commercialEnabled && commercial.length > 0 && (
          <ServiceGroup title="Commercial" services={commercial} />
        )}
      </section>

      {/* ── Why Choose Us ─────────────────────────────────────────────── */}
      <section style={{ background: 'var(--surface-100)' }} id="about">
        <div className="section py-16 md:py-20">
          <SectionHeader
            eyebrow="Why us"
            title={`The ${cfg.businessName} difference`}
            sub="We back every job with a satisfaction guarantee."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-10">
            <WhyCard
              icon={<BadgeCheckIcon />}
              title="Licensed & Insured"
              body="Every technician is fully licensed, insured, and background-checked for your peace of mind."
            />
            <WhyCard
              icon={<ClockFillIcon />}
              title="On-Time Guarantee"
              body="We respect your schedule. If we're late, we make it right — no excuses."
            />
            <WhyCard
              icon={<DollarIcon />}
              title="Transparent Pricing"
              body="Upfront quotes with no hidden fees. You know the full cost before we start any work."
            />
            <WhyCard
              icon={<SparklesIcon />}
              title="Quality Workmanship"
              body="We use professional-grade materials and proven techniques on every single job."
            />
            <WhyCard
              icon={<MapPinSmIcon />}
              title={`Serving ${areas[0] ?? 'Your Area'}`}
              body="Local experts who know the area. We serve Salt Lake County, Utah County, Davis/Weber County, Tooele, and Park City."
            />
            {cfg.scheduling.emergencyAvailable ? (
              <WhyCard
                icon={<BoltIcon />}
                title="Emergency Service"
                body="Urgent issues can't wait. We offer emergency availability to handle critical situations fast."
              />
            ) : (
              <WhyCard
                icon={<HeartIcon />}
                title="Satisfaction Guaranteed"
                body="Not happy? We'll come back and make it right. Our reputation is built on your satisfaction."
              />
            )}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA strip ─────────────────────────────────────────── */}
      {/* id="contact" lives here so the navbar Contact link still resolves now
          that the Service Areas section has been removed. */}
      <section id="contact" style={{ background: 'var(--brand-600)' }}>
        <div className="section py-14 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-extrabold" style={{ color: 'var(--on-brand)' }}>
              Ready to get started?
            </h2>
            <p className="mt-2 text-base opacity-80" style={{ color: 'var(--on-brand)' }}>
              Get a free, no-obligation quote today.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 flex-shrink-0">
            <Link
              href={'/quote/new'}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-base transition-all"
              style={{ background: 'var(--on-brand)', color: 'var(--brand-700)' }}
            >
              Get a free quote
            </Link>
            <a
              href={`tel:${cfg.contact.publicPhone}`}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-base transition-all"
              style={{
                background: 'color-mix(in srgb, var(--on-brand) 15%, transparent)',
                color: 'var(--on-brand)',
                border: '1.5px solid color-mix(in srgb, var(--on-brand) 30%, transparent)',
              }}
            >
              <PhoneSmIcon />
              Call us
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeader({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mb-2">
      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--brand-500)' }}>
        {eyebrow}
      </p>
      <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ color: 'var(--ink-900)' }}>
        {title}
      </h2>
      {sub && (
        <p className="mt-2 text-base" style={{ color: 'var(--ink-500)' }}>{sub}</p>
      )}
    </div>
  );
}

// ── Service group + card ──────────────────────────────────────────────────────

function ServiceGroup({ title, services }: { title: string; services: Service[] }) {
  return (
    <div className="mt-14">
      <div className="flex items-center gap-4 mb-6">
        <h3 className="text-xl md:text-2xl font-bold tracking-tight" style={{ color: '#fb923c' }}>
          {title}
        </h3>
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{ background: 'var(--surface-100)', color: 'var(--ink-500)' }}
        >
          {services.length} service{services.length !== 1 ? 's' : ''}
        </span>
        <div className="flex-1 h-px" style={{ background: 'var(--surface-200)' }} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {services.map(s => <ServiceCard key={s.id} service={s} />)}
      </div>
    </div>
  );
}

function ServiceCard({ service: s }: { service: Service }) {
  const priceLine = s.pricingMode === 'QUOTE_REQUIRED'
    ? 'Custom quote'
    : s.basePriceCents > 0
      ? `From ${(s.basePriceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`
      : 'Contact for price';

  const durationLabel = s.estimatedDurationMinutes
    ? s.estimatedDurationMinutes < 60
      ? `~${s.estimatedDurationMinutes}m`
      : `~${Math.round(s.estimatedDurationMinutes / 60)}h`
    : null;

  const quoteHref = `/quote/${s.slug}`;
  const photo = servicePhoto(s.slug);

  return (
    <Link href={quoteHref} className="card-hover p-6 flex flex-col group overflow-hidden">
      {photo ? (
        // Full-bleed representative photo (overflow-hidden on the card clips it
        // to the rounded corners). Falls back to the emoji icon below.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          loading="lazy"
          className="-mx-6 -mt-6 mb-5 h-44 w-[calc(100%+3rem)] max-w-none object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        /* Icon circle (fallback when no photo is mapped for this service) */
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-xl"
          style={{ background: 'color-mix(in srgb, var(--brand-500) 12%, var(--surface-0))' }}
        >
          {SERVICE_ICON_MAP[s.iconKey ?? ''] ?? <DefaultServiceIcon />}
        </div>
      )}

      <div className="flex-1">
        <h3 className="font-bold text-base leading-snug" style={{ color: 'var(--ink-900)' }}>
          {s.name}
        </h3>
        {s.description && (
          <p className="mt-1.5 text-sm leading-relaxed line-clamp-2" style={{ color: 'var(--ink-500)' }}>
            {s.description}
          </p>
        )}
      </div>

      <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--surface-200)' }}>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full${s.pricingMode === 'QUOTE_REQUIRED' ? '' : ' price-pill'}`}
            style={
              s.pricingMode === 'QUOTE_REQUIRED'
                ? { background: 'var(--surface-100)', color: 'var(--ink-600)' }
                : undefined
            }
          >
            {priceLine}
          </span>
          {durationLabel && (
            <span className="text-xs" style={{ color: 'var(--ink-400)' }}>{durationLabel}</span>
          )}
        </div>
        <span
          className="text-sm font-semibold transition-transform group-hover:translate-x-0.5"
          style={{ color: 'var(--brand-600)' }}
        >
          Quote →
        </span>
      </div>
    </Link>
  );
}

// ── Why choose us card ────────────────────────────────────────────────────────

function WhyCard({ icon, title, body }: { icon: JSX.Element; title: string; body: string }) {
  return (
    <div className="card p-6">
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
        style={{ background: 'color-mix(in srgb, var(--brand-500) 12%, var(--surface-0))' }}
      >
        <span style={{ color: 'var(--brand-600)' }}>{icon}</span>
      </div>
      <h3 className="font-bold text-base mb-1.5" style={{ color: 'var(--ink-900)' }}>{title}</h3>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-500)' }}>{body}</p>
    </div>
  );
}

// ── Trust pill ────────────────────────────────────────────────────────────────

function TrustPill({ icon, label }: { icon: JSX.Element; title?: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink-600)' }}>
      <span style={{ color: 'var(--brand-500)' }}>{icon}</span>
      {label}
    </div>
  );
}

function DefaultServiceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-600)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/>
    </svg>
  );
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function PhoneSmIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z"/></svg>;
}
function ShieldIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
}
function StarIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
}
function ClockIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}
function BadgeCheckIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M9 12l2 2 4-4"/></svg>;
}
function ClockFillIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}
function DollarIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6"/></svg>;
}
function SparklesIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M5 3l.75 2.25L8 6l-2.25.75L5 9l-.75-2.25L2 6l2.25-.75z"/><path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75z"/></svg>;
}
function MapPinSmIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
}
function BoltIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
}
function HeartIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>;
}
