/**
 * Home's community panel: a small universe drawn from how people nearby feel today, one watercolor world
 * with a continent per mood. More land means more people. The small plain planets in the distance carry
 * no data. You are the moon. Drag the world to turn it.
 *
 * Drawn from aggregate bucket counts only, and no position stands for a real place. Only a touch
 * that starts on the world turns it, so the page still scrolls from the space around it.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Canvas,
  Circle,
  Fill,
  Group,
  Path,
  RadialGradient,
  Shader,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { colors, radius, spacing, type } from '../../theme';
import { useDevModeStore } from '../settings/devMode';
import type { MoodBucket } from './aggregate';
import {
  BACKGROUND_PLANETS,
  IDENTITY,
  RING_TILT,
  SCENE_H,
  SCENE_W,
  SPARKLES,
  WORLD,
  dragRotation,
  homeRotation,
  ringPaths,
  rotate,
  worldLands,
  type Mat3,
  type Vec3,
  type WorldLand,
} from './planet';
import { planetShaders } from './planetShaders';

/** How long after a drag a world waits before drifting home. */
const HOME_AFTER_MS = 2500;
const MOON_PER_S = 0.22;
/** How fast a flick dies away, per second. */
const FRICTION = 2.6;
const MAX_FLICK = 5;
/** Finger travel for one radian of turn. */
const DRAG_PX_PER_RADIAN = 56;
/**
 * Each redraw re-renders the whole canvas on the JS thread, so the idle drift (moon, twinkle, the
 * world easing home) runs at a low rate, and only for a while after you arrive or touch the world.
 * After that the picture holds still and costs nothing until the next touch or visit.
 */
const IDLE_FRAME_MS = 83;
const AMBIENT_MS = 20_000;

const rgb = (hex: string): Vec3 => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

const SMALL_PLANETS: [string, string][] = [
  ['#efe8da', '#b8ad99'],
  ['#e6d8c9', '#b4a18f'],
  ['#e2e2ea', '#a6a8bb'],
  ['#e6dcec', '#ad9fbb'],
  ['#e8e3d8', '#b5ac9c'],
  ['#dfe0ee', '#a3a6c0'],
  ['#ecdfd3', '#b9a696'],
];

/** Each label in a deep ink of its own colour on the watercolors, by bucket. */
const PALE_INK = ['#1f4e38', '#6b5108', '#7a3a1e', '#3a4380', '#54406a'];
const STAR_PATH = Skia.Path.MakeFromSVGString(
  'M12 0C12.7 8 16 11.3 24 12C16 12.7 12.7 16 12 24C11.3 16 8 12.7 0 12C8 11.3 11.3 8 12 0Z'
)!;

const THEME = {
  base: rgb('#f8f2e8'),
  clouds: [rgb('#f3dbe6'), rgb('#f8dcc8'), rgb('#e0dcf5')],
  haze: 0.9,
  smallRing: '#a2978a',
  ring: '#9a86b8',
  sparkles: ['#d9ad3f', '#e39abd', '#f0c24e', '#a493e0'],
  moon: '#fffdf8',
  moonStroke: '#9a86b8',
  you: '#4f3f6e',
  sea: { light: rgb('#fffdf8'), dark: rgb('#ece2d6'), cloud: rgb('#eadfe8'), rim: rgb('#d8c8e0') },
};

function ellipseArc(cx: number, cy: number, rx: number, ry: number, deg: number, front: boolean): string {
  const sweep = front ? 0 : 1;
  const t = (deg * Math.PI) / 180;
  const dx = rx * Math.cos(t);
  const dy = rx * Math.sin(t);
  return `M${cx - dx} ${cy - dy}A${rx} ${ry} ${deg} 0 ${sweep} ${cx + dx} ${cy + dy}`;
}

/** The sky never moves, so it lives on its own canvas and is drawn only when its size changes. */
const Sky = memo(function Sky({ width, height, s }: { width: number; height: number; s: number }) {
  const shaders = planetShaders();
  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Fill>
        <Shader
          source={shaders.sky}
          uniforms={{
            scale: s,
            base: THEME.base,
            cloudA: THEME.clouds[0]!,
            cloudB: THEME.clouds[1]!,
            cloudC: THEME.clouds[2]!,
          }}
        />
      </Fill>
      {BACKGROUND_PLANETS.map((p, i) => {
        const [lightColor, darkColor] = SMALL_PLANETS[i % SMALL_PLANETS.length]!;
        const cx = p.x * s;
        const cy = p.y * s;
        const r = p.r * s;
        const paths = p.ring
          ? {
              back: Skia.Path.MakeFromSVGString(ellipseArc(cx, cy, r * 1.7, r * 0.5, 24, false))!,
              front: Skia.Path.MakeFromSVGString(ellipseArc(cx, cy, r * 1.7, r * 0.5, 24, true))!,
            }
          : null;
        return (
          <Group key={p.seed}>
            {paths && <Path path={paths.back} style="stroke" strokeWidth={r * 0.26} color={THEME.smallRing} opacity={0.5} />}
            <Circle cx={cx} cy={cy} r={r + 1}>
              <Shader
                source={shaders.small}
                uniforms={{
                  center: [cx, cy],
                  radius: r,
                  lightColor: rgb(lightColor),
                  darkColor: rgb(darkColor),
                  band: p.band ? 1 : 0,
                  seed: p.seed,
                  haze: THEME.haze,
                }}
              />
            </Circle>
            {paths && <Path path={paths.front} style="stroke" strokeWidth={r * 0.26} color={THEME.smallRing} opacity={0.5} />}
          </Group>
        );
      })}
    </Canvas>
  );
});

function rows(m: Mat3) {
  return { r0: [m[0], m[1], m[2]] as Vec3, r1: [m[3], m[4], m[5]] as Vec3, r2: [m[6], m[7], m[8]] as Vec3 };
}

/** Uniforms for up to five continents, by bucket order; a mood with nobody in it gets no land. */
function landUniforms(lands: WorldLand[], buckets: MoodBucket[]) {
  const out: Record<string, Vec3 | [number, number]> = {};
  [0, 1, 2, 3, 4].forEach((i) => {
    const land = lands[i];
    const zero: Vec3 = [0, 0, 1];
    out[`v${i}`] = land?.v ?? zero;
    out[`u${i}`] = land?.u ?? zero;
    out[`w${i}`] = land?.w ?? zero;
    out[`ab${i}`] = land ? [land.a, land.b] : [0, 0];
    out[`c${i}`] = land ? rgb(buckets[land.group]?.color ?? '#ffffff') : [1, 1, 1];
  });
  return out;
}

export default function MoodPlanet({
  buckets,
  onDragChange,
  visible = true,
}: {
  buckets: MoodBucket[];
  onDragChange?: (dragging: boolean) => void;
  /** False while the panel is scrolled out of view, which stops all drawing. */
  visible?: boolean;
}) {
  const showSampleLabel = useDevModeStore((state) => state.enabled && !state.screenshot);
  const [width, setWidth] = useState(0);
  const s = width / SCENE_W;
  const height = SCENE_H * s;

  const counts = useMemo(() => buckets.map((b) => b.count), [buckets]);
  const lands = useMemo(() => worldLands(counts), [counts]);
  const lands4 = useMemo(() => landUniforms(lands, buckets), [lands, buckets]);

  // Motion lives in refs and one counter redraws, so a frame never waits on stale React state.
  const [, redraw] = useState(0);
  const rotation = useRef<Mat3>(IDENTITY);
  const moon = useRef(0.6);
  const clock = useRef(0);
  const flick = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const touchedAt = useRef(0);
  const frameAt = useRef(0);
  const last = useRef({ dx: 0, dy: 0 });
  const reduceMotion = useRef(false);
  const onDragChangeRef = useRef(onDragChange);
  onDragChangeRef.current = onDragChange;

  // Draws only while all of these hold: the tab is focused, the panel is on screen and the app is
  // in the foreground. Within that, frames run while the world is being dragged or is still
  // spinning from a flick, or for AMBIENT_MS after the last visit or touch; otherwise the loop sleeps.
  const loop = useRef({
    focused: false,
    visible,
    active: AppState.currentState === 'active',
    raf: 0,
    prev: 0,
    drawnAt: 0,
    ambientUntil: 0,
  });
  const wakeRef = useRef<() => void>(() => {});

  const wake = useCallback(() => {
    const L = loop.current;
    if (L.raf || !L.focused || !L.visible || !L.active) return;
    L.prev = 0;
    const frame = () => {
      // performance.now() rather than the callback's timestamp, so it shares a clock with ambientUntil.
      const now = performance.now();
      L.raf = 0;
      if (!L.focused || !L.visible || !L.active) return;
      const dt = L.prev ? Math.min((now - L.prev) / 1000, 0.05) : 0;
      L.prev = now;
      frameAt.current = now;
      const v = flick.current;
      const flicking = !dragging.current && Math.abs(v.x) + Math.abs(v.y) > 0.01;
      const ambient = !reduceMotion.current && now < L.ambientUntil;
      if (!dragging.current) {
        if (flicking) {
          rotation.current = dragRotation(rotation.current, v.x * dt, v.y * dt);
          const decay = Math.exp(-FRICTION * dt);
          flick.current = { x: v.x * decay, y: v.y * decay };
        }
        if (ambient) {
          if (now - touchedAt.current > HOME_AFTER_MS) {
            rotation.current = homeRotation(rotation.current, dt, now / 1000);
          }
          moon.current += MOON_PER_S * dt;
          clock.current = now / 1000;
        }
        if (flicking || (ambient && now - L.drawnAt > IDLE_FRAME_MS)) {
          L.drawnAt = now;
          redraw((n) => n + 1);
        }
      }
      // Drag moves redraw from the gesture itself; the loop only has to stay awake for the flick after.
      if (dragging.current || flicking || ambient) L.raf = requestAnimationFrame(frame);
    };
    L.raf = requestAnimationFrame(frame);
  }, []);
  wakeRef.current = wake;

  const sleep = useCallback(() => {
    const L = loop.current;
    if (L.raf) cancelAnimationFrame(L.raf);
    L.raf = 0;
  }, []);

  useFocusEffect(
    useCallback(() => {
      void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
        reduceMotion.current = on;
      });
      loop.current.focused = true;
      loop.current.ambientUntil = performance.now() + AMBIENT_MS;
      wake();
      return () => {
        loop.current.focused = false;
        sleep();
      };
    }, [wake, sleep])
  );

  useEffect(() => {
    loop.current.visible = visible;
    if (visible) {
      loop.current.ambientUntil = performance.now() + AMBIENT_MS;
      wake();
    } else {
      sleep();
    }
  }, [visible, wake, sleep]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      loop.current.active = state === 'active';
      if (loop.current.active) wake();
      else sleep();
    });
    return () => sub.remove();
  }, [wake, sleep]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragging.current = true;
          loop.current.ambientUntil = performance.now() + AMBIENT_MS;
          wakeRef.current();
          onDragChangeRef.current?.(true);
          flick.current = { x: 0, y: 0 };
          last.current = { dx: 0, dy: 0 };
        },
        onPanResponderMove: (_, g) => {
          rotation.current = dragRotation(
            rotation.current,
            (g.dx - last.current.dx) / DRAG_PX_PER_RADIAN,
            (g.dy - last.current.dy) / DRAG_PX_PER_RADIAN
          );
          last.current = { dx: g.dx, dy: g.dy };
          redraw((n) => n + 1);
        },
        onPanResponderRelease: (_, g) => {
          dragging.current = false;
          touchedAt.current = frameAt.current;
          onDragChangeRef.current?.(false);
          const clamp = (v: number) => Math.max(-MAX_FLICK, Math.min(MAX_FLICK, v));
          // gesture velocity is px/ms; the frame loop wants radians per second.
          flick.current = { x: clamp((g.vx * 1000) / DRAG_PX_PER_RADIAN), y: clamp((g.vy * 1000) / DRAG_PX_PER_RADIAN) };
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          touchedAt.current = frameAt.current;
          onDragChangeRef.current?.(false);
        },
      }),
    []
  );

  const summary = buckets
    .filter((b) => b.count > 0)
    .map((b) => `${b.count} ${b.label.toLowerCase()}`)
    .join(', ');

  // The world, its ring and your moon are always there; a quiet day just has no continents yet.
  const ring = useMemo(() => {
    if (!width) return null;
    const paths = ringPaths(RING_TILT, WORLD.x * s, WORLD.y * s, WORLD.ringR * s);
    return {
      back: Skia.Path.MakeFromSVGString(paths.back || 'M0 0'),
      front: Skia.Path.MakeFromSVGString(paths.front || 'M0 0'),
    };
  }, [s, width]);

  const m = rotation.current;
  const shaders = width ? planetShaders() : null;
  const moonAt = width
    ? (() => {
        const [mx, my, mz] = rotate(RING_TILT, Math.cos(moon.current), 0, Math.sin(moon.current));
        return {
          x: (WORLD.x + mx * WORLD.ringR) * s,
          y: (WORLD.y + my * WORLD.ringR) * s,
          behind: mz < 0,
          // Round the back of the planet the moon is out of sight, and so is its label.
          hidden: mz < 0 && Math.hypot(mx, my) * WORLD.ringR < WORLD.r,
        };
      })()
    : null;
  const moonDot = moonAt && (
    <Group>
      <Circle cx={moonAt.x} cy={moonAt.y} r={5.5 * s} color={THEME.moon} />
      <Circle cx={moonAt.x} cy={moonAt.y} r={5.5 * s} color={THEME.moonStroke} style="stroke" strokeWidth={2 * s} />
    </Group>
  );

  const landLabels = lands.map((land) => {
    const [x, y, z] = rotate(m, land.v[0], land.v[1], land.v[2]);
    return { land, x, y, z };
  });

  return (
    <View>
      <View
        style={[styles.panel, { height: height || SCENE_H }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityLabel={
          summary
            ? `One planet with a continent for each mood in your community today: ${summary}. You are the moon.`
            : 'One planet with no community moods on it yet today. You are the moon.'
        }
      >
        {width > 0 && shaders && (
          <>
            <Sky width={width} height={height} s={s} />
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <Canvas style={StyleSheet.absoluteFill}>
                {ring?.back && <Path path={ring.back} style="stroke" strokeWidth={1.3 * s} color={THEME.ring} opacity={0.45} />}
                {moonAt?.behind && moonDot}

                <>
                  <Circle cx={WORLD.x * s} cy={WORLD.y * s} r={WORLD.r * 1.45 * s}>
                    <RadialGradient
                      c={vec(WORLD.x * s, WORLD.y * s)}
                      r={WORLD.r * 1.45 * s}
                      colors={['#d8c8e000', '#d8c8e000', '#d8c8e088', '#d8c8e000']}
                      positions={[0, 0.66, 0.69, 1]}
                    />
                  </Circle>
                  <Circle cx={WORLD.x * s} cy={WORLD.y * s} r={(WORLD.r + 1) * s}>
                    <Shader
                      source={shaders.world}
                      uniforms={{
                        center: [WORLD.x * s, WORLD.y * s],
                        radius: WORLD.r * s,
                        ...rows(m),
                        seaLight: THEME.sea.light,
                        seaDark: THEME.sea.dark,
                        seaCloud: THEME.sea.cloud,
                        rimColor: THEME.sea.rim,
                        ...lands4,
                      }}
                    />
                  </Circle>
                </>

                {ring?.front && <Path path={ring.front} style="stroke" strokeWidth={1.3 * s} color={THEME.ring} opacity={0.75} />}
                {moonAt && !moonAt.behind && moonDot}

                {SPARKLES.map(([x, y, size, phase], i) => {
                  const wave = reduceMotion.current ? 0.7 : 0.5 + 0.5 * Math.sin((clock.current / 1.8 + phase) * Math.PI * 2);
                  const k = ((0.55 + 0.6 * wave) * size * s) / 24;
                  return (
                    <Group
                      key={i}
                      opacity={0.15 + 0.85 * wave}
                      transform={[{ translateX: x * s }, { translateY: y * s }, { scale: k }, { translateX: -12 }, { translateY: -12 }]}
                    >
                      <Path path={STAR_PATH} color={THEME.sparkles[i % THEME.sparkles.length]!} />
                    </Group>
                  );
                })}
              </Canvas>
            </View>

            {landLabels.map(({ land, x, y, z }) =>
              z < 0.2 ? null : (
                <View
                  key={land.group}
                  pointerEvents="none"
                  style={[
                    styles.landLabelWrap,
                    {
                      left: (WORLD.x + x * WORLD.r * 0.96 - 50) * s,
                      top: (WORLD.y + y * WORLD.r * 0.96 - 10) * s,
                      width: 100 * s,
                      opacity: Math.min(1, (z - 0.2) * 5),
                    },
                  ]}
                >
                  <Text style={[styles.landLabel, { color: PALE_INK[land.group] }]}>
                    {buckets[land.group]?.count} {buckets[land.group]?.label}
                  </Text>
                </View>
              )
            )}

            {moonAt && !moonAt.hidden && (
              <Text
                pointerEvents="none"
                style={[
                  styles.you,
                  {
                    color: THEME.you,
                    // Flips to the moon's left near the panel's edge, so it never clips.
                    left: moonAt.x > width - 40 ? moonAt.x - 34 : moonAt.x + 9,
                    top: moonAt.y - 7,
                  },
                ]}
              >
                You
              </Text>
            )}

            <View
              style={{
                position: 'absolute',
                left: (WORLD.x - WORLD.r) * s,
                top: (WORLD.y - WORLD.r) * s,
                width: WORLD.r * 2 * s,
                height: WORLD.r * 2 * s,
                borderRadius: WORLD.r * s,
              }}
              {...pan.panHandlers}
            />
          </>
        )}
      </View>

      {showSampleLabel && <Text style={styles.sample}>Sample Data</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginTop: spacing.sm,
    backgroundColor: '#f8f2e8',
  },
  landLabelWrap: { position: 'absolute', alignItems: 'center' },
  landLabel: { fontSize: 11, fontWeight: '600', overflow: 'hidden' },
  you: { position: 'absolute', fontSize: 11, fontWeight: '700' },
  sample: { ...type.caption, color: colors.ink2, marginTop: spacing.sm },
});
