/**
 * Bubble pop: bubbles drift up the screen and burst when tapped.
 * The parent owns a fixed pool of slots, and each run of a slot is a freshly mounted <Bubble> keyed by `${slot}-${runId}`, so a bubble is never re-rendered while its animation is in flight.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../../theme';

const POOL = 9;
const TINTS = [colors.primarySoft, colors.tealSoft, colors.roseSoft, colors.amberSoft];
const RIMS = [colors.primary, colors.teal, colors.rose, colors.amber];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

interface BubbleSpec {
  size: number;
  left: number;
  riseMs: number;
  drift: number;
  tint: number;
  delayMs: number;
}

function spawn(width: number, delayMs: number): BubbleSpec {
  const size = rand(44, 92);
  return {
    size,
    left: rand(0, Math.max(1, width - size)),
    riseMs: rand(7000, 15000),
    drift: rand(-30, 30),
    tint: Math.floor(rand(0, TINTS.length)),
    delayMs,
  };
}

interface BubbleProps {
  spec: BubbleSpec;
  height: number;
  onEnd: () => void;
}

const Bubble = React.memo(function Bubble({ spec, height, onEnd }: BubbleProps) {
  const rise = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const poppedRef = useRef(false);
  // Held in a ref so the unmount cleanup can stop whatever is in flight without a re-render.
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    const anim = Animated.timing(rise, {
      toValue: 1,
      duration: spec.riseMs,
      delay: spec.delayMs,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animRef.current = anim;
    anim.start(({ finished }) => {
      if (finished && !poppedRef.current) endRef.current();
    });
    return () => anim.stop();
  }, [rise, spec.riseMs, spec.delayMs]);

  const onPop = useCallback(() => {
    if (poppedRef.current) return;
    poppedRef.current = true;
    animRef.current?.stop();
    const burst = Animated.timing(pop, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animRef.current = burst;
    burst.start(() => endRef.current());
  }, [pop]);

  const translateY = rise.interpolate({
    inputRange: [0, 1],
    outputRange: [height + spec.size, -spec.size],
  });
  const translateX = rise.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, spec.drift, 0],
  });
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const opacity = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.bubbleWrap,
        {
          width: spec.size,
          height: spec.size,
          left: spec.left,
          transform: [{ translateY }, { translateX }, { scale }],
          opacity,
        },
      ]}
    >
      <Pressable
        onPress={onPop}
        accessibilityRole="button"
        accessibilityLabel="Pop bubble"
        style={[
          styles.bubble,
          {
            width: spec.size,
            height: spec.size,
            borderRadius: spec.size / 2,
            backgroundColor: TINTS[spec.tint],
            borderColor: RIMS[spec.tint],
          },
        ]}
      >
        <View
          style={[
            styles.shine,
            {
              width: spec.size * 0.22,
              height: spec.size * 0.22,
              borderRadius: spec.size * 0.11,
              top: spec.size * 0.18,
              left: spec.size * 0.22,
            },
          ]}
        />
      </Pressable>
    </Animated.View>
  );
});

interface Slot {
  runId: number;
  spec: BubbleSpec;
}

export default function BubblePop() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev?.width === width && prev?.height === height ? prev : { width, height }));
  };

  // The first fill staggers the pool up the screen; later respawns come in quickly so the stage stays populated instead of emptying in waves.
  useEffect(() => {
    if (!size) return;
    setSlots(
      Array.from({ length: POOL }, (_, i) => ({
        runId: 0,
        spec: spawn(size.width, i * 900),
      }))
    );
  }, [size]);

  const width = size?.width ?? 0;
  const respawn = useCallback(
    (index: number) => {
      setSlots((prev) =>
        prev == null
          ? prev
          : prev.map((slot, i) =>
              i === index
                ? { runId: slot.runId + 1, spec: spawn(width, rand(200, 1600)) }
                : slot
            )
      );
    },
    [width]
  );

  // One stable callback per slot, so a respawn only re-renders the slot that changed.
  const handlers = useMemo(
    () => Array.from({ length: POOL }, (_, i) => () => respawn(i)),
    [respawn]
  );

  return (
    <View style={styles.stage} onLayout={onLayout}>
      {size != null &&
        slots?.map((slot, i) => (
          <Bubble
            key={`${i}-${slot.runId}`}
            spec={slot.spec}
            height={size.height}
            onEnd={handlers[i]}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    overflow: 'hidden',
  },
  bubbleWrap: {
    position: 'absolute',
    top: 0,
  },
  bubble: {
    borderWidth: 1.5,
    alignItems: 'flex-start',
  },
  shine: {
    backgroundColor: '#ffffff',
    opacity: 0.75,
  },
});
