/** Tap stars in any order to join them; when all are joined the sky resets. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { colors } from '../../theme';

const STAR_COUNT = 7;
const STAR_HIT = 44;
const MARGIN = 36;

interface Star {
  x: number;
  y: number;
  size: number;
}

/** Rejects stars placed too close together, so two 44pt touch targets never overlap. */
function makeSky(width: number, height: number): Star[] {
  const stars: Star[] = [];
  const minGap = Math.min(width, height) / 4;
  let guard = 0;
  while (stars.length < STAR_COUNT && guard < 400) {
    guard += 1;
    const x = MARGIN + Math.random() * Math.max(1, width - MARGIN * 2);
    const y = MARGIN + Math.random() * Math.max(1, height - MARGIN * 2);
    if (stars.some((s) => Math.hypot(s.x - x, s.y - y) < minGap)) continue;
    stars.push({ x, y, size: 8 + Math.random() * 8 });
  }
  return stars;
}

function StarDot({ star, lit, onPress }: { star: Star; lit: boolean; onPress: () => void }) {
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(glow, {
      toValue: lit ? 1 : 0,
      duration: 320,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [lit, glow]);

  const scale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={lit ? 'Star, already joined' : 'Join this star'}
      style={[styles.starHit, { left: star.x - STAR_HIT / 2, top: star.y - STAR_HIT / 2 }]}
    >
      <Animated.View
        style={[
          styles.halo,
          {
            width: star.size * 3,
            height: star.size * 3,
            borderRadius: star.size * 1.5,
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.4] }),
            transform: [{ scale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.star,
          {
            width: star.size,
            height: star.size,
            borderRadius: star.size / 2,
            backgroundColor: lit ? colors.primary : colors.ink3,
            transform: [{ scale }],
          },
        ]}
      />
    </Pressable>
  );
}

export default function Constellation() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [skySeed, setSkySeed] = useState(0);
  const [order, setOrder] = useState<number[]>([]);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stars = useMemo(
    () => (size ? makeSky(size.width, size.height) : []),
    // skySeed is here on purpose: bumping it makes a new sky.
    [size, skySeed]
  );

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev?.width === width && prev?.height === height ? prev : { width, height }));
  };

  const onStar = useCallback(
    (index: number) => {
      setOrder((prev) => {
        if (prev.includes(index)) return prev;
        const next = [...prev, index];
        if (next.length === stars.length && stars.length > 0) {
          // Let the finished shape show for a moment before the sky resets.
          resetTimer.current = setTimeout(() => {
            setOrder([]);
            setSkySeed((s) => s + 1);
          }, 1600);
        }
        return next;
      });
    },
    [stars.length]
  );

  const points = order.map((i) => `${stars[i].x},${stars[i].y}`).join(' ');
  const complete = stars.length > 0 && order.length === stars.length;

  return (
    <View style={styles.sky} onLayout={onLayout}>
      {size != null && (
        <Svg style={StyleSheet.absoluteFill} width={size.width} height={size.height}>
          {order.length > 1 && (
            <Polyline
              points={points}
              fill="none"
              stroke={complete ? colors.primary : colors.primaryDeep}
              strokeOpacity={complete ? 0.9 : 0.55}
              strokeWidth={complete ? 2.5 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </Svg>
      )}
      {stars.map((star, i) => (
        <StarDot key={`${skySeed}-${i}`} star={star} lit={order.includes(i)} onPress={() => onStar(i)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sky: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  starHit: {
    position: 'absolute',
    width: STAR_HIT,
    height: STAR_HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    backgroundColor: colors.primary,
  },
  star: {
    backgroundColor: colors.ink3,
  },
});
