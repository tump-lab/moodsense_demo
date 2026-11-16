/**
 * All animation here uses React Native's built-in `Animated` plus react-native-svg; no reanimated, lottie, skia or moti, since none is installed and adding one needs a native rebuild.
 * The breathing rings use `useNativeDriver: false` because SVG radius/opacity props cannot run on the native driver, and multi-second breathing timings are smooth enough on JS.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { colors } from '../../theme';
import { MoodMascot } from '../checkin/MoodMascot';
import type { ActivityPhase } from './config';

type IoniconName = keyof typeof Ionicons.glyphMap;

const BREATH_EASING = Easing.bezier(0.4, 0.0, 0.2, 1);

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// `fullness` is the one Animated.Value (phase.scaleTo, roughly 0.5..1.05) every ring and glow derives from, so there is never a second clock.
const FULLNESS_DOMAIN: [number, number] = [0.5, 1.05];

function BreathingRings({
  fullness,
  size,
  progress,
}: {
  fullness: Animated.Value;
  size: number;
  progress?: number;
}) {
  const gradientId = useId();
  const [domainMin, domainMax] = FULLNESS_DOMAIN;
  const domainMid40 = domainMin + (domainMax - domainMin) * 0.4;
  const domainMid70 = domainMin + (domainMax - domainMin) * 0.7;

  const outerR = size / 2 - 2;
  const baseR = outerR - 6;

  const fillR = fullness.interpolate({
    inputRange: [domainMin, domainMax],
    outputRange: [baseR * 0.34, baseR * 0.58],
    extrapolate: 'clamp',
  });
  const ring2R = fullness.interpolate({
    inputRange: [domainMin, domainMid40, domainMax],
    outputRange: [baseR * 0.52, baseR * 0.52, baseR * 0.8],
    extrapolate: 'clamp',
  });
  const ring3R = fullness.interpolate({
    inputRange: [domainMin, domainMid70, domainMax],
    outputRange: [baseR * 0.72, baseR * 0.72, baseR],
    extrapolate: 'clamp',
  });
  const ring2Opacity = fullness.interpolate({
    inputRange: [domainMin, domainMax],
    outputRange: [0.16, 0.36],
    extrapolate: 'clamp',
  });
  const ring3Opacity = fullness.interpolate({
    inputRange: [domainMin, domainMax],
    outputRange: [0.08, 0.2],
    extrapolate: 'clamp',
  });

  const progressCircumference = 2 * Math.PI * outerR;
  const progressFraction = progress == null ? 0 : Math.min(1, Math.max(0, progress));
  const progressOffset = progressCircumference * (1 - progressFraction);

  return (
    // Rotated -90deg so the progress ring starts at 12 o'clock instead of SVG's default 3 o'clock.
    // Every shape inside is a centered circle, so nothing else changes.
    <View style={{ width: size, height: size, transform: [{ rotate: '-90deg' }] }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={gradientId} cx="50%" cy="50%" r="55%">
            <Stop offset="0%" stopColor={colors.primarySoft} stopOpacity={1} />
            <Stop offset="100%" stopColor={colors.primary} stopOpacity={0.5} />
          </RadialGradient>
        </Defs>

        {progress != null && (
          <>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={outerR}
              fill="none"
              stroke={colors.line}
              strokeWidth={2}
            />
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={outerR}
              fill="none"
              stroke={colors.primary}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={[progressCircumference, progressCircumference]}
              strokeDashoffset={progressOffset}
            />
          </>
        )}

        <AnimatedCircle cx={size / 2} cy={size / 2} r={ring3R} fill={colors.primary} opacity={ring3Opacity} />
        <AnimatedCircle cx={size / 2} cy={size / 2} r={ring2R} fill={colors.primary} opacity={ring2Opacity} />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={fillR}
          fill={`url(#${gradientId})`}
          stroke={colors.primary}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
}

export function BreathingPreview({ size = 32 }: { size?: number }) {
  const fullness = useRef(new Animated.Value(0.65)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(fullness, {
          toValue: 1,
          duration: 1800,
          easing: BREATH_EASING,
          useNativeDriver: false,
        }),
        Animated.timing(fullness, {
          toValue: 0.65,
          duration: 1800,
          easing: BREATH_EASING,
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [fullness]);

  return (
    <View style={[styles.previewWrap, { width: size, height: size }]}>
      <BreathingRings fullness={fullness} size={size} />
    </View>
  );
}

export function BreathingCircle({
  phase,
  phaseElapsedSec,
  paused,
  size = 220,
}: {
  phase: ActivityPhase;
  phaseElapsedSec: number;
  paused: boolean;
  size?: number;
}) {
  const fullness = useRef(new Animated.Value(0.6)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current?.stop();
    if (paused) return undefined;
    const target = phase.scaleTo ?? 0.7;
    const remainingMs = Math.max(0, (phase.seconds - phaseElapsedSec) * 1000);
    const anim = Animated.timing(fullness, {
      toValue: target,
      duration: remainingMs,
      easing: BREATH_EASING,
      useNativeDriver: false,
    });
    animRef.current = anim;
    anim.start();
    return () => anim.stop();
    // Re-run only when the phase or pause changes, not on every phaseElapsedSec tick, which would restart the animation ~5x/sec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.label, phase.scaleTo, phase.seconds, paused]);

  const progress = phase.seconds > 0 ? phaseElapsedSec / phase.seconds : 0;

  // Today's mascot, always its calm face, breathes with the rings off the same `fullness` value, so it can never drift from them or the voice.
  const reduceMotion = useReduceMotion();
  const mascotScale = fullness.interpolate({
    inputRange: [0.55, 1],
    outputRange: [0.9, 1.1],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.playerStage}>
      <View style={[styles.playerStage, { width: size, height: size }]}>
        <BreathingRings fullness={fullness} size={size} progress={progress} />
        <Animated.View style={[styles.absCenter, !reduceMotion && { transform: [{ scale: mascotScale }] }]}>
          <MoodMascot mood="calm" size={Math.round(size * 0.42)} />
        </Animated.View>
      </View>
    </View>
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduce(value);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

function useIdleBreath() {
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 2200,
          easing: BREATH_EASING,
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 2200,
          easing: BREATH_EASING,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);
  return breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
}

export function PosesPreview({ icons, size = 32 }: { icons: string[]; size?: number }) {
  const unique = icons.length > 0 ? Array.from(new Set(icons)) : ['body-outline'];
  const iconA = unique[0];
  const iconB = unique[1] ?? unique[0];
  const mix = useRef(new Animated.Value(0)).current;
  const breathScale = useIdleBreath();

  useEffect(() => {
    if (iconA === iconB) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(500),
        Animated.timing(mix, {
          toValue: 1,
          duration: 600,
          easing: BREATH_EASING,
          useNativeDriver: true,
        }),
        Animated.delay(500),
        Animated.timing(mix, {
          toValue: 0,
          duration: 600,
          easing: BREATH_EASING,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [iconA, iconB, mix]);

  const opacityA = mix.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={[styles.previewWrap, { width: size, height: size }]}>
      <Animated.View style={[styles.absCenter, { opacity: opacityA, transform: [{ scale: breathScale }] }]}>
        <Ionicons name={iconA as IoniconName} size={size * 0.62} color={colors.teal} />
      </Animated.View>
      <Animated.View style={{ opacity: mix, transform: [{ scale: breathScale }] }}>
        <Ionicons name={iconB as IoniconName} size={size * 0.62} color={colors.teal} />
      </Animated.View>
    </View>
  );
}

/** Which body part of the quick-stretch follow-along figure should move for a given phase label. */
export type StretchMoveId = 'neck' | 'shoulders' | 'fold' | 'side';

export function stretchMoveForLabel(label: string): StretchMoveId {
  const l = label.toLowerCase();
  if (l.includes('neck')) return 'neck';
  if (l.includes('shoulder')) return 'shoulders';
  if (l.includes('forward') || l.includes('fold')) return 'fold';
  return 'side';
}

function useSwing(duration = 1400) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration, easing: BREATH_EASING, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration, easing: BREATH_EASING, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [value, duration]);
  return value;
}

/**
 * A simple stick figure that visually demonstrates the current quick-stretch move (head tilts for
 * neck roll, shoulder bar rocks for shoulder rolls, upper body compresses for forward fold, upper body
 * leans for side stretch), so the move isn't only described in text — built from plain Views and the
 * same loop/easing pattern as the rest of this file (no svg path work, so it's robust without a native rebuild).
 */
export function StretchFollowAlong({ moveId, size = 220 }: { moveId: StretchMoveId; size?: number }) {
  const swing = useSwing(1400);
  const reduceMotion = useReduceMotion();
  const k = size / 220;

  const neckRotate = swing.interpolate({ inputRange: [0, 1], outputRange: ['-16deg', '16deg'] });
  const shoulderRotate = swing.interpolate({ inputRange: [0, 1], outputRange: ['-9deg', '9deg'] });
  const sideRotate = swing.interpolate({ inputRange: [0, 1], outputRange: ['-18deg', '18deg'] });
  const foldScaleY = swing.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] });

  const upperTransform =
    reduceMotion
      ? []
      : [
          { rotate: moveId === 'side' ? sideRotate : '0deg' },
          { scaleY: moveId === 'fold' ? foldScaleY : 1 },
        ];

  return (
    <View style={styles.playerStage}>
      <View style={[styles.poseCircle, { width: size, height: size, borderRadius: size / 2 }]}>
        <View style={styles.figureWrap}>
          <Animated.View style={[styles.figureCol, styles.figureFoldOrigin, { transform: upperTransform }]}>
            <Animated.View
              style={[
                styles.figureHead,
                { width: 32 * k, height: 32 * k, borderRadius: 16 * k },
                !reduceMotion && moveId === 'neck' && { transform: [{ rotate: neckRotate }] },
              ]}
            />
            <Animated.View
              style={[
                styles.figureShoulderRow,
                { width: 70 * k, marginTop: 4 * k },
                !reduceMotion && moveId === 'shoulders' && { transform: [{ rotate: shoulderRotate }] },
              ]}
            >
              <View style={[styles.figureDot, { width: 13 * k, height: 13 * k, borderRadius: 7 * k }]} />
              <View style={[styles.figureBar, { width: 44 * k, height: 7 * k }]} />
              <View style={[styles.figureDot, { width: 13 * k, height: 13 * k, borderRadius: 7 * k }]} />
            </Animated.View>
            <View style={[styles.figureTorso, { width: 16 * k, height: 54 * k, marginTop: 2 * k }]} />
          </Animated.View>
          <View style={[styles.figureLegRow, { width: 40 * k, marginTop: 6 * k }]}>
            <View style={[styles.figureLeg, { width: 13 * k, height: 44 * k }]} />
            <View style={[styles.figureLeg, { width: 13 * k, height: 44 * k }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

export function PoseCrossfade({ icon, size = 220 }: { icon: string; size?: number }) {
  const [prevIcon, setPrevIcon] = useState(icon);
  const [currIcon, setCurrIcon] = useState(icon);
  const mix = useRef(new Animated.Value(1)).current;
  const breathScale = useIdleBreath();

  useEffect(() => {
    if (icon === currIcon) return;
    setPrevIcon(currIcon);
    setCurrIcon(icon);
    mix.setValue(0);
    Animated.timing(mix, {
      toValue: 1,
      duration: 550,
      easing: BREATH_EASING,
      useNativeDriver: true,
    }).start();
    // currIcon is read each run to detect a real change in the `icon` prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icon]);

  const prevOpacity = mix.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const prevScale = mix.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] });
  const currScale = mix.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] });
  const reduceMotion = useReduceMotion();
  const badge = Math.round(size * 0.24);

  // Same calm mascot as the breathing circle; the move's icon rides in a small badge so each phase still shows what to do.
  return (
    <View style={styles.playerStage}>
      <View style={[styles.poseCircle, { width: size, height: size, borderRadius: size / 2 }]}>
        <Animated.View style={!reduceMotion && { transform: [{ scale: breathScale }] }}>
          <MoodMascot mood="calm" size={Math.round(size * 0.5)} />
        </Animated.View>
        <View style={[styles.poseBadge, { width: badge, height: badge, borderRadius: badge / 2 }]}>
          <Animated.View
            style={[styles.absCenter, { opacity: prevOpacity, transform: [{ scale: prevScale }] }]}
          >
            <Ionicons name={prevIcon as IoniconName} size={badge * 0.5} color={colors.teal} />
          </Animated.View>
          <Animated.View style={{ opacity: mix, transform: [{ scale: currScale }] }}>
            <Ionicons name={currIcon as IoniconName} size={badge * 0.5} color={colors.teal} />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  previewWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  absCenter: {
    position: 'absolute',
  },
  playerStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  poseCircle: {
    backgroundColor: colors.tealSoft,
    borderWidth: 2,
    borderColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poseBadge: {
    position: 'absolute',
    right: '6%',
    bottom: '6%',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  figureWrap: {
    alignItems: 'center',
  },
  figureCol: {
    alignItems: 'center',
  },
  // Pivots the fold's scaleY from the top (head/shoulders) so the figure compresses down toward the
  // torso's base, reading as folding forward rather than shrinking from the middle.
  figureFoldOrigin: {
    transformOrigin: 'top',
  },
  figureHead: {
    backgroundColor: colors.teal,
  },
  figureShoulderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  figureDot: {
    backgroundColor: colors.teal,
  },
  figureBar: {
    backgroundColor: colors.teal,
    borderRadius: 4,
  },
  figureTorso: {
    backgroundColor: colors.teal,
    borderRadius: 8,
  },
  figureLegRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  figureLeg: {
    backgroundColor: colors.teal,
    borderRadius: 7,
  },
});
