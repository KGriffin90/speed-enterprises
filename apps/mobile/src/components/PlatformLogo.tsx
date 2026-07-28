import { Image, View, StyleSheet } from 'react-native';

const LOGO = require('../../assets/logos/speed-enterprises-logo@1024.png');

/**
 * Speed Enterprises logo — the real artwork the web app serves from
 * apps/web/public/logos (generated into assets/logos by scripts/generate-icons.sh).
 *
 * The wordmark is white-on-black, so it's rendered inside a self-contained dark
 * badge to stay legible on any background — light or dark screens (sign-in /
 * sign-up / forgot-password) and the splash.
 */
export function PlatformLogo({ size = 64 }: { size?: number }) {
  return (
    <View style={[s.badge, { width: size, height: size, borderRadius: Math.round(size * 0.26) }]}>
      <Image source={LOGO} style={s.img} resizeMode="contain" />
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  img: { width: '84%', height: '84%' },
});
