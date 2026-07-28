import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Linking, Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { apiCall, DEFAULT_TENANT_SLUG } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme/ThemeProvider';
import { servicePhoto, serviceEmoji } from '@/lib/service-icons';
import { HeroImageRotator } from '@/components/HeroImageRotator';
import { PlatformLogo } from '@/components/PlatformLogo';
import { ThemeToggle } from '@/components/ui';
import { StorefrontFooter, type StorefrontFooterConfig } from '@/components/StorefrontFooter';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg';

// Bundled drone-style hero stills — the same artwork web rotates in its hero
// (apps/web/public/images/hero). Cross-faded + Ken-Burns-drifted by
// HeroImageRotator so the stack reads like slow aerial footage.
const HERO_IMAGES = [
  require('../../assets/images/hero/residential.webp'),
  require('../../assets/images/hero/commercial.webp'),
  require('../../assets/images/hero/restaurant.webp'),
];

interface Service {
  id: string; slug: string; name: string; description: string;
  category: string; pricingMode: string; basePriceCents: number;
  iconKey?: string | null;
  estimatedDurationMinutes?: number | null;
  visibleOnPublicSite?: boolean;
  active?: boolean;
}
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type DayHours = 'closed' | { open: string; close: string };

interface PublicConfig {
  slug: string;
  businessName: string;
  legalName?: string | null;
  tagline: string | null;
  industry?: string;
  industryLabel: string;
  branding: { logoUrl?: string | null; wordmarkText?: string | null; heroImageUrl?: string | null };
  contact: {
    publicPhone?: string | null;
    publicEmail?: string | null;
    serviceAreas?: { label: string }[];
    address?: { city?: string | null; state?: string | null } | null;
    socialLinks?: {
      facebook?: string; instagram?: string; yelp?: string;
      googleBusinessProfile?: string; website?: string;
    } | null;
  };
  scheduling: {
    emergencyAvailable?: boolean;
    timezone?: string;
    operatingHours?: Partial<Record<DayKey, DayHours>> | null;
  };
  features: { residentialEnabled?: boolean; commercialEnabled?: boolean };
  services: Service[];
}

/**
 * Public tenant storefront — the mobile equivalent of the web tenant landing
 * page. Reachable signed-out: a customer picks a business on the discovery
 * screen and lands here. Browsing is fully public; the only gated action is
 * submitting a quote (handled inside the wizard).
 */
export default function StorefrontScreen() {
  const router = useRouter();
  const t = useTheme();
  const { session, setBrowsingSlug } = useAuth();
  const { slug: slugParam } = useLocalSearchParams<{ slug?: string }>();
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // Role-aware shortcut back into the signed-in console (the storefront is
  // also the post-signup / post-signout landing page, so it must never be a
  // dead end for any role).
  const role = session?.tenant?.role;
  const consoleLink = role === 'CUSTOMER'
    ? { label: 'My Quotes', icon: 'document-text-outline' as const, href: '/(customer)/quotes' }
    : role === 'STAFF'
      ? { label: 'My Jobs', icon: 'briefcase-outline' as const, href: '/(staff)/jobs' }
      : role === 'OWNER'
        ? { label: 'Dashboard', icon: 'speedometer-outline' as const, href: '/(admin)/quotes' }
        : null;

  function openConsole() {
    if (!consoleLink) return;
    // Back to the authed area: session tenant drives theming again.
    setBrowsingSlug(null);
    router.navigate(consoleLink.href as any);
  }

  useEffect(() => {
    (async () => {
      // Single-business app: fall back to the Speed Enterprises default tenant so
      // the storefront always loads, even on a fresh install (the deleted
      // business-discovery screen was the only writer of 'browsing_slug').
      const slug = slugParam
        ?? (await SecureStore.getItemAsync('browsing_slug'))
        ?? DEFAULT_TENANT_SLUG;
      try { setCfg(await apiCall<PublicConfig>('GET', `/api/config/${slug}`)); }
      catch {} finally { setLoading(false); }
    })();
  }, [slugParam]);

  function startQuote(serviceSlug?: string) {
    // Pass the business explicitly so the wizard targets THIS storefront's
    // tenant regardless of any signed-in session's tenant.
    router.push({
      pathname: '/(platform)/quote' as any,
      params: { ...(serviceSlug ? { service: serviceSlug } : {}), ...(cfg?.slug ? { slug: cfg.slug } : {}) },
    });
  }

  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: t.surface[50] }]}>
        <ActivityIndicator color={t.brand.brand500} />
      </View>
    );
  }

  if (!cfg) {
    return (
      <SafeAreaView style={[s.center, { backgroundColor: t.surface[50] }]}>
        <Text style={[s.errText, { color: t.ink[700] }]}>Couldn't load this business.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[s.errLink, { color: t.brand.brand600 }]}>← Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const visible = (cfg.services ?? []).filter(
    s => s && s.visibleOnPublicSite !== false && s.active !== false,
  );
  const residential = visible.filter(s => s.category !== 'COMMERCIAL');
  const commercial  = visible.filter(s => s.category !== 'RESIDENTIAL');
  const areas = (cfg.contact.serviceAreas ?? []).map(a => a.label);
  const phone = cfg.contact.publicPhone ?? null;
  const badgeBg = t.isDark ? t.brand.brand500 : t.brand.brand50;
  const badgeFg = t.isDark ? '#ffffff' : t.brand.brand700;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.surface[50] }]} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Top bar — the storefront is the app's landing page (no back button).
            Logo on the left; theme toggle + console/sign-in on the right,
            mirroring the web header. */}
        <View style={s.topBar}>
          <View style={s.brandRow}>
            {/* Only trust a real remote logo (https). The tenant's seeded
                logoUrl is a localhost/web-origin asset that can't resolve on a
                device, so fall back to the bundled Speed Enterprises mark. */}
            {cfg.branding.logoUrl?.startsWith('https://')
              ? <Image source={{ uri: cfg.branding.logoUrl }} style={s.logo} />
              : <PlatformLogo size={30} />}
            <Text style={[s.wordmark, { color: t.ink[900] }]} numberOfLines={1}>
              {cfg.branding.wordmarkText ?? cfg.businessName}
            </Text>
          </View>
          <View style={s.topBarActions}>
            <ThemeToggle />
            {consoleLink ? (
              <TouchableOpacity
                style={[s.myQuotesBtn, { backgroundColor: t.brand.brand50 }]}
                onPress={openConsole}
                accessibilityLabel={consoleLink.label}
              >
                <Ionicons name={consoleLink.icon} size={15} color={t.brand.brand600} />
                <Text style={[s.myQuotesText, { color: t.brand.brand600 }]}>{consoleLink.label}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.myQuotesBtn, { backgroundColor: t.brand.brand50 }]}
                onPress={() => router.push({ pathname: '/(auth)/sign-in', params: { slug: cfg.slug } })}
                accessibilityLabel="Sign in"
              >
                <Ionicons name="person-circle-outline" size={15} color={t.brand.brand600} />
                <Text style={[s.myQuotesText, { color: t.brand.brand600 }]}>Sign in</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Hero — animated drone-style stills under a directional wash + subtle
            brand tint, mirroring web's .hero-gradient. The surface-0 heroWrap
            background shows if the stills haven't decoded yet. */}
        <View style={[s.heroWrap, { backgroundColor: t.surface[0] }]}>
          {/* Animated drone-style stills (cross-fade + slow zoom/pan), mirroring
              web's HeroImageRotator. */}
          <HeroImageRotator sources={HERO_IMAGES} />
          {/* Directional wash — mirrors web's .hero-gradient so the footage reads
              while the headline stays legible: heavier at the top behind the
              title, lighter toward the bottom where the footage shows through. */}
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <SvgLinearGradient id="heroWash" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={t.surface[0]} stopOpacity={0.92} />
                <Stop offset="0.55" stopColor={t.surface[0]} stopOpacity={0.7} />
                <Stop offset="1" stopColor={t.surface[0]} stopOpacity={0.48} />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroWash)" />
          </Svg>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: t.brand.brand500, opacity: 0.05 }]} pointerEvents="none" />
        <View style={s.hero}>
          <View style={s.badgeRow}>
            <View style={[s.badge, { backgroundColor: badgeBg }]}>
              <Text style={[s.badgeText, { color: badgeFg }]}>{"• Utah's choice for spotless windows."}</Text>
            </View>
            {cfg.scheduling.emergencyAvailable && (
              <View style={[s.badge, { backgroundColor: t.surface[100] }]}>
                <Text style={[s.badgeText, { color: t.ink[700] }]}>24/7 Emergency</Text>
              </View>
            )}
          </View>
          <Text style={[s.heroTitle, { color: t.ink[900] }]}>
            {cfg.tagline ?? `${cfg.industryLabel} you can trust`}
          </Text>
          <Text style={[s.heroSub, { color: t.ink[500] }]}>
            Serving Salt Lake City Metro and the Wasatch front.
          </Text>

          <TouchableOpacity style={[s.cta, { backgroundColor: t.brand.brand500, borderRadius: t.radius }]} onPress={() => startQuote()}>
            <Text style={[s.ctaText, { color: t.brand.onBrand }]}>Get a Free Quote</Text>
          </TouchableOpacity>
          {phone && (
            <TouchableOpacity style={[s.callBtn, { borderColor: t.surface[200], borderRadius: t.radius }]} onPress={() => Linking.openURL(`tel:${phone}`)}>
              <Ionicons name="call-outline" size={16} color={t.ink[700]} />
              <Text style={[s.callText, { color: t.ink[700] }]}>{phone}</Text>
            </TouchableOpacity>
          )}

          {/* Quick trust row — mirrors web's hero trust pills. */}
          <View style={s.trustRow}>
            <TrustPill icon="shield-checkmark-outline" label="Licensed & Insured" t={t} />
            <TrustPill icon="star-outline" label="Free Estimates" t={t} />
            <TrustPill
              icon="time-outline"
              label={cfg.scheduling.emergencyAvailable ? '24/7 Available' : 'Fast Response'}
              t={t}
            />
          </View>
        </View>
        </View>

        {/* Services */}
        <View style={s.section}>
          <Text style={[s.eyebrow, { color: t.brand.brand500 }]}>WHAT WE DO</Text>
          <Text style={[s.sectionTitle, { color: t.ink[900] }]}>Our Services</Text>
          <Text style={[s.sectionSub, { color: t.ink[500] }]}>
            {visible.length} service{visible.length !== 1 ? 's' : ''} available — get a custom quote in minutes
          </Text>

          {cfg.features.residentialEnabled !== false && residential.length > 0 && (
            <ServiceGroup title="Residential" services={residential} onPick={startQuote} t={t} />
          )}
          {cfg.features.commercialEnabled && commercial.length > 0 && (
            <ServiceGroup title="Commercial" services={commercial} onPick={startQuote} t={t} />
          )}
        </View>

        {/* Why choose us — mirrors web's "The {businessName} difference". */}
        <View style={[s.whySection, { backgroundColor: t.surface[100] }]}>
          <Text style={[s.eyebrow, { color: t.brand.brand500 }]}>WHY US</Text>
          <Text style={[s.sectionTitle, { color: t.ink[900] }]}>The {cfg.businessName} difference</Text>
          <Text style={[s.sectionSub, { color: t.ink[500] }]}>We back every job with a satisfaction guarantee.</Text>
          <View style={s.whyGrid}>
            <WhyCard t={t} icon="shield-checkmark-outline" title="Licensed & Insured"
              body="Every technician is fully licensed, insured, and background-checked for your peace of mind." />
            <WhyCard t={t} icon="time-outline" title="On-Time Guarantee"
              body="We respect your schedule. If we're late, we make it right — no excuses." />
            <WhyCard t={t} icon="cash-outline" title="Transparent Pricing"
              body="Upfront quotes with no hidden fees. You know the full cost before we start any work." />
            <WhyCard t={t} icon="sparkles-outline" title="Quality Workmanship"
              body="We use professional-grade materials and proven techniques on every single job." />
            <WhyCard t={t} icon="location-outline" title={`Serving ${areas[0] ?? 'Your Area'}`}
              body="Local experts who know the area. We serve Salt Lake County, Utah County, Davis/Weber County, Tooele, and Park City." />
            {cfg.scheduling.emergencyAvailable ? (
              <WhyCard t={t} icon="flash-outline" title="Emergency Service"
                body="Urgent issues can't wait. We offer emergency availability to handle critical situations fast." />
            ) : (
              <WhyCard t={t} icon="heart-outline" title="Satisfaction Guaranteed"
                body="Not happy? We'll come back and make it right. Our reputation is built on your satisfaction." />
            )}
          </View>
        </View>


        {/* Bottom CTA */}
        <View style={[s.bottomCta, { backgroundColor: t.brand.brand600, borderRadius: t.radius }]}>
          <Text style={[s.bottomCtaTitle, { color: t.brand.onBrand }]}>Ready to get started?</Text>
          <Text style={[s.bottomCtaSub, { color: t.brand.onBrand }]}>Get a free, no-obligation quote today.</Text>
          <TouchableOpacity style={[s.bottomCtaBtn, { backgroundColor: t.brand.onBrand, borderRadius: t.radius }]} onPress={() => startQuote()}>
            <Text style={[s.bottomCtaBtnText, { color: t.brand.brand700 }]}>Get a free quote</Text>
          </TouchableOpacity>
        </View>

        {/* Footer — store hours, contact, social, legal (mirrors web). */}
        <StorefrontFooter cfg={cfg as StorefrontFooterConfig} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ServiceGroup({ title, services, onPick, t }: {
  title: string; services: Service[]; onPick: (slug: string) => void; t: ReturnType<typeof useTheme>;
}) {
  // Price-pill colors mirror web: soft brand tint on light, solid fill on dark.
  const pillBg = t.isDark ? t.brand.brand500 : t.brand.brand50;
  const pillFg = t.isDark ? '#ffffff' : t.brand.brand700;
  return (
    <View style={{ marginTop: 24 }}>
      {/* Prominent group header (mirrors web): bold title + count pill + rule. */}
      <View style={s.groupHeader}>
        {/* Near-black on light; light orange on dark so it pops on the dark surface. */}
        <Text style={[s.groupTitle, { color: t.isDark ? '#fb923c' : t.ink[900] }]}>{title}</Text>
        <View style={[s.groupCount, { backgroundColor: t.surface[100] }]}>
          <Text style={[s.groupCountText, { color: t.ink[500] }]}>
            {services.length} service{services.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <View style={[s.groupRule, { backgroundColor: t.surface[200] }]} />
      </View>
      {services.map(svc => {
        const price = svc.pricingMode === 'QUOTE_REQUIRED'
          ? 'Custom quote'
          : svc.basePriceCents > 0
            ? `From ${(svc.basePriceCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`
            : 'Contact for price';
        // Mirror web's ServiceCard duration label (~Xm / ~Xh).
        const duration = svc.estimatedDurationMinutes
          ? svc.estimatedDurationMinutes < 60
            ? `~${svc.estimatedDurationMinutes}m`
            : `~${Math.round(svc.estimatedDurationMinutes / 60)}h`
          : null;
        const photo = servicePhoto(svc.slug);
        return (
          <TouchableOpacity
            key={svc.id}
            style={[s.svcCard, { backgroundColor: t.surface[0], borderColor: t.surface[200], borderRadius: t.radius }]}
            onPress={() => onPick(svc.slug)}
            activeOpacity={0.85}
          >
            {/* Full-bleed representative photo (card overflow clips it to the
                rounded corners), or the emoji icon circle as the fallback —
                exactly web's ServiceCard. */}
            {photo && <Image source={photo} style={s.svcPhoto} resizeMode="cover" />}
            <View style={s.svcBody}>
              {!photo && (
                <View style={[s.svcIcon, { backgroundColor: t.brand.brand50 }]}>
                  <Text style={s.svcIconEmoji}>{serviceEmoji(svc.iconKey)}</Text>
                </View>
              )}
              <Text style={[s.svcName, { color: t.ink[900] }]}>{svc.name}</Text>
              {!!svc.description && <Text style={[s.svcDesc, { color: t.ink[500] }]} numberOfLines={2}>{svc.description}</Text>}
              <View style={[s.svcFooter, { borderTopColor: t.surface[200] }]}>
                <View style={s.svcFooterLeft}>
                  <View style={[s.pricePill, { backgroundColor: pillBg }]}>
                    <Text style={[s.priceText, { color: pillFg }]}>{price}</Text>
                  </View>
                  {duration && <Text style={[s.svcDuration, { color: t.ink[300] }]}>{duration}</Text>}
                </View>
                <Text style={[s.svcArrow, { color: t.brand.brand600 }]}>Quote →</Text>
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function TrustPill({ icon, label, t }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={s.trustPill}>
      <Ionicons name={icon} size={14} color={t.brand.brand500} />
      <Text style={[s.trustLabel, { color: t.ink[700] }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function WhyCard({ icon, title, body, t }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; body: string; t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={[s.whyCard, { backgroundColor: t.surface[0], borderColor: t.surface[200], borderRadius: t.radius }]}>
      <View style={[s.whyIcon, { backgroundColor: t.brand.brand50 }]}>
        <Ionicons name={icon} size={20} color={t.brand.brand600} />
      </View>
      <Text style={[s.whyTitle, { color: t.ink[900] }]}>{title}</Text>
      <Text style={[s.whyBody, { color: t.ink[500] }]}>{body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errText: { fontSize: 15 },
  errLink: { fontSize: 15, fontWeight: '600' },
  scroll: { paddingBottom: 40 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  topBarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  logo: { width: 30, height: 30, borderRadius: 8 },
  wordmark: { fontSize: 16, fontWeight: '800', flex: 1 },
  myQuotesBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 7 },
  myQuotesText: { fontSize: 12, fontWeight: '700' },
  heroWrap: { overflow: 'hidden', marginBottom: 32 },
  hero: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  badge: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  heroTitle: { fontSize: 30, fontWeight: '800', lineHeight: 36, marginBottom: 12 },
  heroSub: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  cta: { paddingVertical: 15, alignItems: 'center' },
  ctaText: { fontSize: 16, fontWeight: '700' },
  callBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderWidth: 1.5, marginTop: 10 },
  callText: { fontSize: 15, fontWeight: '600' },
  section: { paddingHorizontal: 20, paddingTop: 28 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  sectionTitle: { fontSize: 24, fontWeight: '800', marginBottom: 6 },
  sectionSub: { fontSize: 14, lineHeight: 20 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  groupTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.2 },
  groupCount: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  groupCountText: { fontSize: 11, fontWeight: '700' },
  groupRule: { flex: 1, height: 1 },
  svcCard: { borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  svcPhoto: { width: '100%', height: 140 },
  svcBody: { padding: 16 },
  svcIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  svcIconEmoji: { fontSize: 22 },
  svcName: { fontSize: 16, fontWeight: '700' },
  svcDesc: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  svcFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 14, borderTopWidth: 1 },
  svcFooterLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  svcDuration: { fontSize: 12 },
  pricePill: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  priceText: { fontSize: 12, fontWeight: '700' },
  svcArrow: { fontSize: 14, fontWeight: '700' },
  trustRow: { flexDirection: 'row', flexWrap: 'nowrap', columnGap: 12, marginTop: 18 },
  trustPill: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  trustLabel: { fontSize: 12, fontWeight: '600' },
  whySection: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 28, marginTop: 28 },
  whyGrid: { marginTop: 16, gap: 12 },
  whyCard: { borderWidth: 1, padding: 16 },
  whyIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  whyTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  whyBody: { fontSize: 13, lineHeight: 19 },
  bottomCta: { margin: 20, marginTop: 28, padding: 24, alignItems: 'flex-start' },
  bottomCtaTitle: { fontSize: 22, fontWeight: '800' },
  bottomCtaSub: { fontSize: 14, opacity: 0.85, marginTop: 6, marginBottom: 18 },
  bottomCtaBtn: { paddingHorizontal: 22, paddingVertical: 13 },
  bottomCtaBtnText: { fontSize: 15, fontWeight: '800' },
});
