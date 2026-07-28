/**
 * StorefrontFooter — native mirror of web's TenantFooter
 * (apps/web/src/app/layout.tsx). Renders the business's store hours, contact
 * details, social links, and a copyright + legal row at the bottom of the
 * Speed Enterprises storefront. Fully theme-driven so it adapts to dark mode.
 */
import { View, Text, StyleSheet, TouchableOpacity, Linking, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { PlatformLogo } from '@/components/PlatformLogo';
import { openLegal, type LegalSlug } from '@/lib/legal';

// Local copies of the shared scheduling shapes (config.ts) — kept inline to
// avoid coupling the storefront to the zod schema package at the type level.
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type DayHours = 'closed' | { open: string; close: string };

export interface StorefrontFooterConfig {
  businessName: string;
  legalName?: string | null;
  tagline?: string | null;
  branding: { logoUrl?: string | null; wordmarkText?: string | null };
  contact: {
    publicPhone?: string | null;
    publicEmail?: string | null;
    serviceAreas?: { label: string }[];
    address?: { city?: string | null; state?: string | null } | null;
    socialLinks?: {
      facebook?: string;
      instagram?: string;
      yelp?: string;
      googleBusinessProfile?: string;
      website?: string;
    } | null;
  };
  scheduling: {
    operatingHours?: Partial<Record<DayKey, DayHours>> | null;
    emergencyAvailable?: boolean;
  };
}

const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL: Record<DayKey, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

const LEGAL_LINKS: { slug: LegalSlug; label: string }[] = [
  { slug: 'privacy-policy',   label: 'Privacy' },
  { slug: 'terms-of-service', label: 'Terms' },
  { slug: 'cookie-policy',    label: 'Cookies' },
];

export function StorefrontFooter({ cfg }: { cfg: StorefrontFooterConfig }) {
  const t = useTheme();
  const social = cfg.contact.socialLinks ?? {};
  const hours = cfg.scheduling.operatingHours ?? {};
  const areas = (cfg.contact.serviceAreas ?? []).map(a => a.label);
  const cityState = [cfg.contact.address?.city, cfg.contact.address?.state].filter(Boolean).join(', ');
  const phone = cfg.contact.publicPhone;
  const email = cfg.contact.publicEmail;

  const socialItems: { url: string; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    social.facebook              && { url: social.facebook,              icon: 'logo-facebook' as const,  label: 'Facebook' },
    social.instagram             && { url: social.instagram,             icon: 'logo-instagram' as const, label: 'Instagram' },
    social.yelp                  && { url: social.yelp,                  icon: 'logo-yelp' as const,      label: 'Yelp' },
    social.googleBusinessProfile && { url: social.googleBusinessProfile, icon: 'logo-google' as const,    label: 'Google' },
    social.website               && { url: social.website,               icon: 'globe-outline' as const,  label: 'Website' },
  ].filter(Boolean) as { url: string; icon: keyof typeof Ionicons.glyphMap; label: string }[];

  return (
    <View style={[s.root, { backgroundColor: t.surface[0], borderTopColor: t.surface[200] }]}>
      {/* Brand */}
      <View style={s.brandRow}>
        {/* Bundled mark unless a real remote (https) logo is set — the seeded
            logoUrl is a localhost asset unreachable from a device. */}
        {cfg.branding.logoUrl?.startsWith('https://')
          ? <Image source={{ uri: cfg.branding.logoUrl }} style={s.logo} />
          : <PlatformLogo size={38} />}
        <Text style={[s.wordmark, { color: t.ink[900] }]} numberOfLines={1}>
          {cfg.branding.wordmarkText ?? cfg.businessName}
        </Text>
      </View>
      {!!cfg.tagline && <Text style={[s.tagline, { color: t.ink[500] }]}>{cfg.tagline}</Text>}

      {/* Social */}
      {socialItems.length > 0 && (
        <View style={s.social}>
          {socialItems.map(item => (
            <TouchableOpacity
              key={item.label}
              style={[s.socialBtn, { backgroundColor: t.surface[100] }]}
              onPress={() => Linking.openURL(item.url).catch(() => undefined)}
              accessibilityLabel={item.label}
            >
              <Ionicons name={item.icon} size={18} color={t.ink[500]} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Hours */}
      {Object.keys(hours).length > 0 && (
        <View style={s.block}>
          <Text style={[s.eyebrow, { color: t.ink[300] }]}>HOURS</Text>
          {DAY_ORDER.map(day => {
            const h = hours[day];
            if (!h) return null;
            return (
              <View key={day} style={s.hourRow}>
                <Text style={[s.day, { color: t.ink[500] }]}>{DAY_LABEL[day]}</Text>
                {h === 'closed'
                  ? <Text style={[s.hourVal, { color: t.ink[300] }]}>Closed</Text>
                  : <Text style={[s.hourVal, { color: t.ink[700] }]}>{h.open} – {h.close}</Text>}
              </View>
            );
          })}
          {cfg.scheduling.emergencyAvailable && (
            <View style={[s.emergencyBadge, { backgroundColor: t.brand.brand50 }]}>
              <Text style={[s.emergencyText, { color: t.brand.brand700 }]}>24/7 Emergency Available</Text>
            </View>
          )}
        </View>
      )}

      {/* Contact */}
      <View style={s.block}>
        <Text style={[s.eyebrow, { color: t.ink[300] }]}>CONTACT</Text>
        {!!phone && (
          <TouchableOpacity style={s.contactRow} onPress={() => Linking.openURL(`tel:${phone}`)}>
            <Ionicons name="call-outline" size={15} color={t.ink[500]} />
            <Text style={[s.contactText, { color: t.ink[700] }]}>{phone}</Text>
          </TouchableOpacity>
        )}
        {!!email && (
          <TouchableOpacity style={s.contactRow} onPress={() => Linking.openURL(`mailto:${email}`)}>
            <Ionicons name="mail-outline" size={15} color={t.ink[500]} />
            <Text style={[s.contactText, { color: t.ink[700] }]}>{email}</Text>
          </TouchableOpacity>
        )}
        {areas.length > 0 && (
          <View style={s.contactRow}>
            <Ionicons name="location-outline" size={15} color={t.ink[500]} />
            <Text style={[s.contactText, { color: t.ink[500] }]}>{areas.join(', ')}</Text>
          </View>
        )}
        {!!cityState && (
          <Text style={[s.contactText, { color: t.ink[500], marginLeft: 23 }]}>{cityState}</Text>
        )}
      </View>

      {/* Bottom bar */}
      <View style={[s.bottomBar, { borderTopColor: t.surface[200] }]}>
        <Text style={[s.copyright, { color: t.ink[300] }]}>
          © {new Date().getFullYear()} {cfg.legalName ?? cfg.businessName}. All rights reserved.
        </Text>
        <View style={s.legalRow}>
          {LEGAL_LINKS.map(item => (
            <TouchableOpacity key={item.slug} onPress={() => openLegal(item.slug)}>
              <Text style={[s.legalLink, { color: t.ink[500] }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { marginTop: 28, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 28, borderTopWidth: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  logo: { width: 38, height: 38, borderRadius: 10 },
  wordmark: { fontSize: 18, fontWeight: '800', flexShrink: 1 },
  tagline: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  social: { flexDirection: 'row', gap: 10, marginTop: 14 },
  socialBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  block: { marginTop: 24 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 10 },
  hourRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  day: { fontSize: 14 },
  hourVal: { fontSize: 14, fontWeight: '600' },
  emergencyBadge: { alignSelf: 'flex-start', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12 },
  emergencyText: { fontSize: 12, fontWeight: '700' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  contactText: { fontSize: 14, flexShrink: 1 },
  bottomBar: { marginTop: 26, paddingTop: 18, borderTopWidth: 1, gap: 12 },
  copyright: { fontSize: 12, lineHeight: 17 },
  legalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  legalLink: { fontSize: 13, fontWeight: '500' },
});
