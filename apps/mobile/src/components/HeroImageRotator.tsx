import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, type ImageSourcePropType } from 'react-native';

/**
 * Animated hero background — the native mirror of web's HeroImageRotator
 * (apps/web/src/components/HeroImageRotator.tsx). Cross-fades through several
 * full-bleed stills while each slowly zooms + pans (a Ken Burns drift), so the
 * stack reads like slow aerial drone footage.
 *
 * All transforms/opacity run on the native driver, so the drift stays smooth
 * even while the storefront list scrolls.
 */
export function HeroImageRotator({
  sources,
  intervalMs = 6000,
}: {
  sources: ImageSourcePropType[];
  intervalMs?: number;
}) {
  const [active, setActive] = useState(0);
  // One opacity value per still; the first starts visible.
  const opacities = useRef(sources.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  // Shared Ken Burns drift (0 → 1 → 0), mapped to scale + translate below.
  const pan = useRef(new Animated.Value(0)).current;

  // Slow zoom + pan loop (mirrors web's heroPan: ~20s each way, ease-in-out).
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pan, { toValue: 1, duration: 20000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pan, { toValue: 0, duration: 20000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pan]);

  // Advance to the next still on a fixed cadence (the crossfade is the opacity
  // transition below). Single-image sets never advance.
  useEffect(() => {
    if (sources.length < 2) return;
    const id = setInterval(() => setActive(i => (i + 1) % sources.length), intervalMs);
    return () => clearInterval(id);
  }, [sources.length, intervalMs]);

  // Crossfade to the active still (web uses a 1600ms opacity transition).
  useEffect(() => {
    Animated.parallel(
      opacities.map((o, i) =>
        Animated.timing(o, {
          toValue: i === active ? 1 : 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [active, opacities]);

  // scale stays > 1 through the drift so the pan never exposes an edge.
  const scale = pan.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1.18] });
  const translateX = pan.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });
  const translateY = pan.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });

  return (
    <>
      {sources.map((src, i) => (
        <Animated.Image
          key={i}
          source={src}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          style={[
            StyleSheet.absoluteFill,
            { width: '100%', height: '100%', opacity: opacities[i], transform: [{ scale }, { translateX }, { translateY }] },
          ]}
        />
      ))}
    </>
  );
}
