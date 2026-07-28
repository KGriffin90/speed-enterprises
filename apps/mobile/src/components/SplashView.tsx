import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, Easing } from 'react-native';
import { PlatformLogo } from '@/components/PlatformLogo';

export function SplashView() {
  const logoScale    = useRef(new Animated.Value(0.3)).current;
  const logoOpacity  = useRef(new Animated.Value(0)).current;
  const ringScale    = useRef(new Animated.Value(0.6)).current;
  const ringOpacity  = useRef(new Animated.Value(0)).current;
  const titleY       = useRef(new Animated.Value(30)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const tagOpacity   = useRef(new Animated.Value(0)).current;
  const dot1         = useRef(new Animated.Value(0)).current;
  const dot2         = useRef(new Animated.Value(0)).current;
  const dot3         = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Ring expands first
    Animated.parallel([
      Animated.timing(ringScale,   { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(ringOpacity, { toValue: 0.15, duration: 700, useNativeDriver: true }),
    ]).start();

    // Logo pops in
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.spring(logoScale,   { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();

    // Title slides up
    Animated.sequence([
      Animated.delay(500),
      Animated.parallel([
        Animated.timing(titleY,       { toValue: 0, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(titleOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();

    // Tagline fades in
    Animated.sequence([
      Animated.delay(800),
      Animated.timing(tagOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();

    // Loading dots stagger
    const dotAnim = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          Animated.delay(400),
        ])
      );

    Animated.sequence([
      Animated.delay(900),
      Animated.parallel([
        dotAnim(dot1, 0),
        dotAnim(dot2, 200),
        dotAnim(dot3, 400),
      ]),
    ]).start();
  }, []);

  return (
    <View style={s.root}>
      {/* Background glow rings */}
      <Animated.View style={[s.ring, s.ring1, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
      <Animated.View style={[s.ring, s.ring2, { transform: [{ scale: Animated.multiply(ringScale, 1.6) }], opacity: Animated.multiply(ringOpacity, 0.6) }]} />

      {/* Logo — the real Speed Enterprises mark (assets/logos), on its dark badge */}
      <Animated.View style={[s.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        <View style={s.logoGlow}>
          <PlatformLogo size={96} />
        </View>
        {/* Orbit dot */}
        <View style={s.orbitDot} />
      </Animated.View>

      {/* Wordmark */}
      <Animated.Text style={[s.title, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}>
        Speed Enterprises
      </Animated.Text>

      <Animated.Text style={[s.tagline, { opacity: tagOpacity }]}>
        Quality service you can trust
      </Animated.Text>

      {/* Loading dots */}
      <View style={s.dots}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View key={i} style={[s.dot, { opacity: dot }]} />
        ))}
      </View>
    </View>
  );
}

const BRAND = '#4f46e5';
const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },

  ring:      { position: 'absolute', borderRadius: 99999, borderWidth: 1, borderColor: BRAND },
  ring1:     { width: 260, height: 260 },
  ring2:     { width: 260, height: 260 },

  logoWrap:  { alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  // The logo badge is self-contained (dark); this wrapper just casts the
  // brand-tinted glow halo behind it on the black splash.
  logoGlow:  { borderRadius: 26, backgroundColor: '#000000', shadowColor: BRAND, shadowOpacity: 0.7, shadowRadius: 30, shadowOffset: { width: 0, height: 0 }, elevation: 20 },
  orbitDot:  { position: 'absolute', top: 4, right: 4, width: 14, height: 14, borderRadius: 7, backgroundColor: '#a5b4fc', shadowColor: '#a5b4fc', shadowOpacity: 1, shadowRadius: 6, elevation: 6 },

  title:     { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: 0.5, marginBottom: 8 },
  tagline:   { fontSize: 14, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.3 },

  dots:      { flexDirection: 'row', gap: 8, marginTop: 52 },
  dot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: BRAND },
});
