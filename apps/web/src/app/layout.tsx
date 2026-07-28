// @ts-ignore
import './globals.css';
import type { JSX } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { loadTenantConfig } from '@/lib/tenant';
import { readMe } from '@/lib/server-auth';
import { renderThemeStyles, renderThemeVars, fontStylesheetHref } from '@/lib/theme';
import type { BusinessConfig } from '@speed-enterprises/shared';
import { ChatWidget } from '@/components/ChatWidget';
import { ConditionalTenantHeader } from '@/components/ConditionalTenantHeader';
import { ConditionalTenantFooter } from '@/components/ConditionalTenantFooter';
import { NavBackButton } from '@/components/NavBackButton';
import { MobileMenuToggle } from '@/components/MobileMenuToggle';
import { SessionGuard } from '@/components/SessionGuard';
import { BackToTop } from '@/components/BackToTop';
import { ThemeToggle } from '@/components/ThemeToggle';

export async function generateMetadata(): Promise<Metadata> {
  try {
    const cfg = await loadTenantConfig();
    return {
      title: { default: cfg.businessName, template: `%s · ${cfg.businessName}` },
      description: cfg.tagline ?? cfg.industryLabel,
      icons: { icon: cfg.branding.faviconUrl },
      openGraph: {
        title:       cfg.businessName,
        description: cfg.tagline ?? cfg.industryLabel,
        images:      cfg.branding.ogImageUrl ? [cfg.branding.ogImageUrl] : undefined,
      },
    };
  } catch {
    // Defensive fallback for the rare case the business config can't be loaded
    // (e.g. the API is briefly unavailable). Normal requests always resolve the
    // Speed Enterprises tenant via middleware, so this branch is not a landing page.
    return {
      title: process.env.PLATFORM_NAME ?? 'Speed Enterprises',
      description: 'Request a free quote and book service online.',
      icons: { icon: process.env.NEXT_PUBLIC_PLATFORM_FAVICON || '/platform-icon.svg' },
    };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }): Promise<JSX.Element> {
  let cfg: BusinessConfig | null = null;
  try { cfg = await loadTenantConfig(); } catch { /* no tenant */ }

  const me = readMe();
  const role = me?.tenant?.role;
  const isAdminOrAbove = role === 'OWNER';
  const themeCss = cfg ? renderThemeStyles(cfg.branding) : '';
  const themeVars = cfg ? renderThemeVars(cfg.branding) : {};
  const fontHref = cfg ? fontStylesheetHref(cfg.branding) : null;

  return (
    // suppressHydrationWarning: the inline theme script sets data-theme on <html>
    // before hydration, which the server markup doesn't include.
    <html lang={cfg?.locale ?? 'en-US'} suppressHydrationWarning>
      <head>
        {fontHref && (<>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={fontHref} />
        </>)}
        {/* First-paint: set :root vars so SSR is correct before hydration */}
        {themeCss && <style dangerouslySetInnerHTML={{ __html: themeCss }} />}
        {/* Apply the saved (or system) light/dark theme before first paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {/*
          Tenant theme wrapper — inline CSS vars here override the :root defaults
          from globals.css on every RSC render, ensuring the correct tenant theme
          is always applied even on client-side navigation where <head> may not
          be re-patched by Next.js. Each tenant's variables are fully isolated to
          this subtree; nothing bleeds across tenants.
        */}
        <div style={themeVars as React.CSSProperties}>
          <SessionGuard />
          {cfg && (
            <ConditionalTenantHeader>
              <TenantNav cfg={cfg} isLoggedIn={!!me} isAdmin={isAdminOrAbove} />
            </ConditionalTenantHeader>
          )}
          <main>{children}</main>
          {cfg && (
            <ConditionalTenantFooter>
              <TenantFooter cfg={cfg} />
            </ConditionalTenantFooter>
          )}
          {/* Chat widget on every page, for everyone. Responses are scoped by
              the active tenant (slug from cookie/header); platform pages with no
              tenant get the platform-level assistant. */}
          <ChatWidget businessName={cfg?.businessName ?? (process.env.PLATFORM_NAME ?? 'Speed Enterprises')} />
          <BackToTop hasChatWidget />
        </div>
      </body>
    </html>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function TenantNav({ cfg, isLoggedIn, isAdmin }: { cfg: BusinessConfig; isLoggedIn: boolean; isAdmin: boolean }) {
  const navItems = [
    { label: 'Home',     href: `/?tenant=${cfg.slug}#home` },
    { label: 'Services', href: `/?tenant=${cfg.slug}#services` },
    { label: 'About',    href: `/?tenant=${cfg.slug}#about` },
    { label: 'Contact',  href: `/?tenant=${cfg.slug}#contact` },
  ];

  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: 'color-mix(in srgb, var(--surface-0) 92%, transparent)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--surface-200)',
      }}
    >
      {/* Content-aligned row: the logo sits in the same px-6 gutter as the page
          content (hero text), and the right-side actions end at the same gutter. */}
      <div className="section h-16 flex items-center justify-between gap-4">

        {/* Back button (in-flow; hidden on the storefront home) + logo */}
        <div className="flex items-center gap-2 min-w-0">
          {/* Context-aware back button: hidden on home; on deeper pages it returns home. */}
          <NavBackButton />
          {/* Logo + wordmark — links home */}
          <Link href="/" className="flex items-center gap-3 flex-shrink-0">
            {cfg.branding.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cfg.branding.logoUrl}
                alt=""
                className="h-9 w-9 rounded-xl object-cover"
                style={{ border: '1px solid var(--surface-200)' }}
              />
            )}
            <span className="text-base font-extrabold tracking-tight" style={{ color: 'var(--ink-900)' }}>
              {cfg.branding.wordmarkText}
            </span>
          </Link>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--surface-100)]"
              style={{ color: 'var(--ink-600)' } as React.CSSProperties}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right side actions */}
        <div className="flex items-center gap-2 md:gap-3">

          {/* Auth / account */}
          {isLoggedIn
            ? <Link href="/dashboard" className="hidden md:inline-flex btn-secondary text-sm py-2 px-4">My account</Link>
            : <Link href="/auth/sign-in" className="hidden md:inline-flex text-sm font-medium transition-opacity hover:opacity-70" style={{ color: 'var(--ink-600)' } as React.CSSProperties}>Sign in</Link>
          }

          {/* Dark / light toggle — between Sign in and the CTA */}
          <ThemeToggle />

          {/* Primary CTA */}
          {!isAdmin && (
            <Link
              href="/quote/new"
              className="btn-primary text-sm py-2 px-4 hidden sm:inline-flex"
            >
              Get a Free Quote!
            </Link>
          )}

          {/* Mobile hamburger */}
          <MobileMenuToggle items={navItems} phone={cfg.contact.publicPhone} tenantSlug={cfg.slug} />
        </div>
      </div>
    </header>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function TenantFooter({ cfg }: { cfg: BusinessConfig }) {
  const social = cfg.contact.socialLinks;
  const hours  = cfg.scheduling.operatingHours;
  const visibleServices = cfg.services.filter(s => s.visibleOnPublicSite && s.active);

  const dayOrder: Array<keyof typeof hours> = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayLabel: Record<string, string> = {
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
  };

  return (
    <footer style={{ background: 'var(--surface-0)', borderTop: '1px solid var(--surface-200)' }}>
      {/* Main footer grid */}
      <div className="section py-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">

        {/* Col 1 — Brand */}
        <div className="sm:col-span-2 lg:col-span-1">
          <Link href="/" className="flex items-center gap-3 mb-4">
            {cfg.branding.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cfg.branding.logoUrl} alt="" className="h-10 w-10 rounded-xl object-cover" />
            )}
            <span className="font-extrabold text-lg" style={{ color: 'var(--ink-900)' }}>
              {cfg.branding.wordmarkText}
            </span>
          </Link>
          {cfg.tagline && (
            <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--ink-500)' }}>
              {cfg.tagline}
            </p>
          )}
          {/* Social links */}
          {Object.keys(social).length > 0 && (
            <div className="flex items-center gap-3 mt-4">
              {social.facebook && <SocialLink href={social.facebook} label="Facebook"><FacebookIcon /></SocialLink>}
              {social.instagram && <SocialLink href={social.instagram} label="Instagram"><InstagramIcon /></SocialLink>}
              {social.yelp && <SocialLink href={social.yelp} label="Yelp"><YelpIcon /></SocialLink>}
              {social.googleBusinessProfile && <SocialLink href={social.googleBusinessProfile} label="Google"><GoogleIcon /></SocialLink>}
              {social.website && <SocialLink href={social.website} label="Website"><GlobeIcon /></SocialLink>}
            </div>
          )}
        </div>

        {/* Col 2 — Services */}
        {visibleServices.length > 0 && (
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--ink-400)' }}>
              Services
            </h4>
            <ul className="space-y-2.5">
              {visibleServices.slice(0, 7).map(s => (
                <li key={s.id}>
                  <Link
                    href={`/quote/${s.slug}`}
                    className="text-sm transition-colors hover:underline"
                    style={{ color: 'var(--ink-600)' } as React.CSSProperties}
                  >
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Col 3 — Contact */}
        <div>
          <h4 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--ink-400)' }}>
            Contact
          </h4>
          <ul className="space-y-3">
            <li>
              <a href={`tel:${cfg.contact.publicPhone}`} className="text-sm flex items-start gap-2 hover:opacity-80 transition-opacity" style={{ color: 'var(--ink-600)' } as React.CSSProperties}>
                <PhoneIcon />
                <span>{cfg.contact.publicPhone}</span>
              </a>
            </li>
            <li>
              <a href={`mailto:${cfg.contact.publicEmail}`} className="text-sm flex items-start gap-2 hover:opacity-80 transition-opacity" style={{ color: 'var(--ink-600)' } as React.CSSProperties}>
                <MailIcon />
                <span>{cfg.contact.publicEmail}</span>
              </a>
            </li>
            {cfg.contact.serviceAreas.length > 0 && (
              <li className="text-sm flex items-start gap-2" style={{ color: 'var(--ink-500)' }}>
                <MapPinIcon />
                <span>{cfg.contact.serviceAreas.map(a => a.label).join(', ')}</span>
              </li>
            )}
            {cfg.contact.address.city && (
              <li className="text-sm" style={{ color: 'var(--ink-500)' }}>
                {[cfg.contact.address.city, cfg.contact.address.state].filter(Boolean).join(', ')}
              </li>
            )}
          </ul>
        </div>

        {/* Col 4 — Hours */}
        <div>
          <h4 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--ink-400)' }}>
            Hours
          </h4>
          <ul className="space-y-1.5">
            {dayOrder.map(day => {
              const h = hours[day];
              if (!h) return null;
              return (
                <li key={day} className="flex items-center justify-between text-sm gap-4">
                  <span style={{ color: 'var(--ink-500)' }}>{dayLabel[day]}</span>
                  {h === 'closed'
                    ? <span style={{ color: 'var(--ink-300)' }}>Closed</span>
                    : <span style={{ color: 'var(--ink-700)' }}>{h.open} – {h.close}</span>
                  }
                </li>
              );
            })}
            {cfg.scheduling.emergencyAvailable && (
              <li className="mt-3">
                <span className="badge-accent">24/7 Emergency Available</span>
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{ borderTop: '1px solid var(--surface-200)' }}>
        <div className="section py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs" style={{ color: 'var(--ink-300)' }}>
          <span>© {new Date().getFullYear()} {cfg.legalName ?? cfg.businessName}. All rights reserved.</span>
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link href="/legal/privacy-policy" className="transition-opacity hover:opacity-70" style={{ color: 'var(--ink-500)' }}>Privacy</Link>
            <Link href="/legal/terms-of-service" className="transition-opacity hover:opacity-70" style={{ color: 'var(--ink-500)' }}>Terms</Link>
            <Link href="/legal/cookie-policy" className="transition-opacity hover:opacity-70" style={{ color: 'var(--ink-500)' }}>Cookies</Link>
            <Link href="/legal" className="transition-opacity hover:opacity-70" style={{ color: 'var(--ink-500)' }}>Legal</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

// ── Small icon components ─────────────────────────────────────────────────────

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z"/>
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="M2 7l10 7 10-7"/>
    </svg>
  );
}
function MapPinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

function SocialLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--brand-100)] hover:text-[var(--brand-600)]"
      style={{ background: 'var(--surface-100)', color: 'var(--ink-500)' } as React.CSSProperties}
    >
      {children}
    </a>
  );
}

function FacebookIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>;
}
function InstagramIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>;
}
function YelpIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-5l4 2.5-4 2.5zm0-7V4.5l4 2.5-4 2.5z"/></svg>;
}
function GoogleIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>;
}
function GlobeIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>;
}
