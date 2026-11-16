/**
 * Ripple pond: touch the water and watch the rings spread and fade.
 * Rings unmount when their animation ends, and MAX_RIPPLES stops a fast tapper from mounting hundreds of views.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing, type } from '../../theme';

const MAX_RIPPLES = 14;
const RING_SIZE = 40;
const SPREAD = 7.5;
const DURATION_MS = 2600;
const TINTS = [colors.primary, colors.teal, colors.rose, colors.amber];

interface RippleSpec {
  key: number;
  x: number;
  y: number;
  tint: string;
}

function Ripple({ spec, onDone }: { spec: RippleSpec; onDone: (key: number) => void }) {
  const progress = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => onDone(spec.key));
  }, [progress, onDone, spec.key]);

  // Three rings from one touch, each starting a beat after the last — one
  // expanding circle reads as a bubble, three read as water.
  return (
    <>
      {[0, 0.18, 0.36].map((offset, i) => {
        const scale = progress.interpolate({
          inputRange: [offset, 1],
          outputRange: [0.2, SPREAD],
          extrapolate: 'clamp',
        });
        const opacity = progress.interpolate({
          inputRange: [offset, offset + 0.12, 1],
          outputRange: [0, 0.5 - i * 0.12, 0],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              styles.ring,
              {
                left: spec.x - RING_SIZE / 2,
                top: spec.y - RING_SIZE / 2,
                borderColor: spec.tint,
                transform: [{ scale }],
                opacity,
              },
            ]}
          />
        );
      })}
    </>
  );
}

export default function RipplePond() {
  const [ripples, setRipples] = useState<RippleSpec[]>([]);
  const nextKey = useRef(0);
  const [touched, setTouched] = useState(false);

  const onTouch = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    nextKey.current += 1;
    const spec: RippleSpec = {
      key: nextKey.current,
      x: locationX,
      y: locationY,
      tint: TINTS[nextKey.current % TINTS.length],
    };
    setTouched(true);
    setRipples((prev) => [...prev.slice(-(MAX_RIPPLES - 1)), spec]);
  }, []);

  const onDone = useCallback((key: number) => {
    setRipples((prev) => prev.filter((r) => r.key !== key));
  }, []);

  return (
    <Pressable style={styles.pond} onPressIn={onTouch}>
      <View style={styles.tintTop} pointerEvents="none" />
      {ripples.map((spec) => (
        <Ripple key={spec.key} spec={spec} onDone={onDone} />
      ))}
      {!touched && (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={styles.hint}>Touch the water</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pond: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    justifyContent: 'center',
  },
  // A barely-there wash so the surface reads as water rather than as a
  // blank card someone forgot to fill in.
  tintTop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.primarySoft,
    opacity: 0.45,
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.5,
  },
  hintWrap: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  hint: {
    ...type.sub,
    color: colors.ink3,
  },
});
