/**
 * Twelve original mascots, each drawn in the five moods, used in place of platform emoji; one is on
 * duty at a time, picked by mascotRoster's day and night shifts.
 * All share one face grammar so each mood reads the same way on every character, and each character
 * adds exactly one body signal of its own — more than one and the moods stop being comparable.
 * The head is fixed at cx 32 / cy 34 with r ~19 in the 64 viewBox, which is what lets every
 * character reuse <Face /> unchanged.
 */
import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { type Mascot, mascotOnDuty, msUntilNextShift } from './mascotRoster';
import type { Mood } from './store';

export type { Mascot } from './mascotRoster';

// The characters' own colors, not theme tokens: they are illustration and must stay put if the theme changes.
const INK = '#4a3b2f';
const BLUSH = '#f2a7a0';
const DROP = '#8fb6e6';

interface FaceProps {
  mood: Mood;
}

/**
 * Tired is told apart by the face alone (heavy lids, a yawn, a drifting "z"); each character's body
 * signal stays at rest, as it does for Calm, so the twelve drawings did not each need a fifth pose.
 */
function bodyMood(mood: Mood): Exclude<Mood, 'tired'> {
  return mood === 'tired' ? 'calm' : mood;
}

function Face({ mood }: FaceProps) {
  const stroke = { stroke: INK, strokeWidth: 2.2, strokeLinecap: 'round' as const, fill: 'none' };
  const blush = (
    <>
      <Circle cx={20} cy={36} r={2.6} fill={BLUSH} opacity={0.75} />
      <Circle cx={44} cy={36} r={2.6} fill={BLUSH} opacity={0.75} />
    </>
  );
  switch (mood) {
    case 'calm':
      return (
        <G>
          {blush}
          <Path d="M22 31q4-4 8 0M34 31q4-4 8 0M27 38.5q5 3 10 0" {...stroke} />
        </G>
      );
    case 'good':
      return (
        <G>
          {blush}
          <Circle cx={26} cy={30.5} r={2.5} fill={INK} />
          <Circle cx={38} cy={30.5} r={2.5} fill={INK} />
          <Circle cx={27} cy={29.6} r={0.8} fill="#fff" />
          <Circle cx={39} cy={29.6} r={0.8} fill="#fff" />
          <Path d="M25 37q7 6.5 14 0" {...stroke} />
        </G>
      );
    case 'stressed':
      return (
        <G>
          <Path d="M21 27.5l6.5-2.5M43 27.5l-6.5-2.5" {...stroke} />
          <Circle cx={26} cy={31.5} r={2.9} fill={INK} />
          <Circle cx={38} cy={31.5} r={2.9} fill={INK} />
          <Circle cx={27} cy={30.5} r={0.9} fill="#fff" />
          <Circle cx={39} cy={30.5} r={0.9} fill="#fff" />
          <Path d="M26 39.5q3-2.2 6 0t6 0" {...stroke} />
          <Path d="M48 22q3 4 0 6.5q-3-2.5 0-6.5z" fill={DROP} />
        </G>
      );
    case 'low':
      return (
        <G>
          <Path d="M21.5 28.5l6.5-1.5M42.5 28.5l-6.5-1.5" {...stroke} />
          <Circle cx={26} cy={32.5} r={1.9} fill={INK} />
          <Circle cx={38} cy={32.5} r={1.9} fill={INK} />
          <Path d="M27.5 40q4.5-3 9 0" {...stroke} />
          <Path d="M41.5 35q2.2 3 0 5q-2.2-2 0-5z" fill={DROP} />
        </G>
      );
    case 'tired':
      return (
        <G>
          {blush}
          <Path d="M22 31.5q4 2.5 8 0M34 31.5q4 2.5 8 0" {...stroke} />
          <Path d="M21.5 29.5h8.5M34 29.5h8.5" {...stroke} strokeWidth={1.4} opacity={0.6} />
          <Ellipse cx={32} cy={39.5} rx={2.6} ry={3} fill={INK} />
          <Path d="M46 18h5l-5 5h5" {...stroke} strokeWidth={1.8} />
        </G>
      );
  }
}

/** Shared bits of weather, so Sunny's cloud and Luna's cloud are the same cloud. */
function Cloud({ x, y, fill = '#e9e2d8' }: { x: number; y: number; fill?: string }) {
  return (
    <G x={x} y={y}>
      <Ellipse cx={6} cy={8} rx={11} ry={6} fill={fill} />
      <Circle cx={2} cy={5} r={5.5} fill={fill} />
      <Circle cx={9} cy={3.5} r={6} fill={fill} />
    </G>
  );
}

function Sparkle({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  const i = r * 0.3;
  return (
    <Path
      d={`M${x} ${y - r}L${x + i} ${y - i}L${x + r} ${y}L${x + i} ${y + i}L${x} ${y + r}L${x - i} ${y + i}L${x - r} ${y}L${x - i} ${y - i}Z`}
      fill={fill}
    />
  );
}

/* ----------------------------------- day shift ----------------------------------- */

/** Sunny, a small sun. Rays dim and a cloud drifts in when Low. */
function Sunny({ mood }: FaceProps) {
  const low = mood === 'low';
  const ray = low ? '#e8d9a8' : '#f3c14e';
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return (
      <Line
        key={i}
        x1={32 + Math.cos(a) * 22}
        y1={33 + Math.sin(a) * 22}
        x2={32 + Math.cos(a) * 28}
        y2={33 + Math.sin(a) * 28}
        stroke={ray}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
    );
  });
  return (
    <G>
      {rays}
      <Circle cx={32} cy={33} r={18} fill={low ? '#f2d98a' : '#f8cf5e'} />
      <Face mood={mood} />
      {low && <Cloud x={36} y={40} />}
    </G>
  );
}

/** Bao, a steamed bun. The steam is the signal: a wisp when Calm, a rolling puff when Stressed, none when Low. */
function Bao({ mood }: FaceProps) {
  // Deeper than the cream app background (#faf6ee) on purpose: at #fdf4e6 the bun vanished into it.
  const BUN = '#fbecd8';
  const PLEAT = '#e4d2b2';
  const EDGE = '#e9d6b4';
  const steam = { stroke: '#b9cdd8', strokeWidth: 2.5, strokeLinecap: 'round' as const, fill: 'none' };
  const squat = mood === 'low';
  return (
    <G>
      {mood === 'calm' && <Path d="M24 11q3.5-3.5 0-7" {...steam} />}
      {mood === 'good' && <Path d="M22 10q3.5-3.5 0-7M42 10q3.5-3.5 0-7" {...steam} />}
      {mood === 'stressed' && <Path d="M18 11q4-4 0-8M31 8q4-4 0-8M45 11q4-4 0-8" {...steam} />}
      <Path
        d="M15 25q5-9 9-1M26 22q6-9 11 0M37 21q6-8 10 2"
        stroke={PLEAT}
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx={32} cy={19} r={3.6} fill={BUN} stroke={EDGE} strokeWidth={1.2} />
      <Ellipse
        cx={32}
        cy={squat ? 40 : 38}
        rx={21}
        ry={squat ? 16.5 : 18.5}
        fill={BUN}
        stroke={EDGE}
        strokeWidth={1.4}
      />
      <Path d="M14 40q18 7 36 0" stroke={PLEAT} strokeWidth={1.6} fill="none" opacity={0.55} />
      <Face mood={mood} />
    </G>
  );
}

/** Peachy, a peach. The leaf is the signal: it stands up when Good and curls under when Low. */
function Peachy({ mood }: FaceProps) {
  const SKIN = '#f8c0bd';
  const LEAF = '#9ac49a';
  const leaf = {
    calm: <Path d="M33 12q10-5 11 2q-9 5-11-2z" fill={LEAF} />,
    good: <Path d="M34 11q7-10 11-3q-5 8-11 3z" fill={LEAF} />,
    stressed: <Path d="M33 13q11-2 10 5q-10 2-10-5z" fill={LEAF} />,
    low: <Path d="M33 14q10 3 7 9q-9-1-7-9z" fill="#a9bca2" />,
  }[bodyMood(mood)];
  return (
    <G>
      <Circle cx={32} cy={36} r={19.5} fill={SKIN} />
      <Path d="M32 17.5q-3.5 5-2.5 9.5" stroke="#eda7a8" strokeWidth={2} strokeLinecap="round" fill="none" />
      <Path d="M31.5 18q-0.5-7 1.5-9.5" stroke="#8a6f4e" strokeWidth={2.2} strokeLinecap="round" fill="none" />
      {leaf}
      {mood === 'good' && <Sparkle x={48} y={20} r={3.4} fill="#f0d27a" />}
      <Face mood={mood} />
    </G>
  );
}

/** Puff, a cloud. What falls below is the signal: sun sparks when Good, a bolt, then rain. */
function Puff({ mood }: FaceProps) {
  const F = mood === 'low' ? '#dde3ec' : '#eef2f7';
  return (
    <G>
      {mood === 'good' && (
        <G>
          <Sparkle x={52} y={16} r={4.6} fill="#f3c14e" />
          <Sparkle x={11} y={18} r={3} fill="#f3c14e" />
        </G>
      )}
      {mood === 'stressed' && (
        <Path
          d="M30 52l4-6h-5l5-7"
          stroke="#f0d27a"
          strokeWidth={2.6}
          strokeLinejoin="round"
          fill="none"
        />
      )}
      {mood === 'low' && (
        <Path
          d="M20 50q2.4 3.4 0 5.4q-2.4-2-0-5.4zM32 53q2.4 3.4 0 5.4q-2.4-2-0-5.4zM44 50q2.4 3.4 0 5.4q-2.4-2-0-5.4z"
          fill={DROP}
        />
      )}
      <Ellipse cx={32} cy={38} rx={21} ry={13} fill={F} />
      <Circle cx={19} cy={33} r={10} fill={F} />
      <Circle cx={33} cy={27} r={12.5} fill={F} />
      <Circle cx={45} cy={34} r={9.5} fill={F} />
      <Face mood={mood} />
    </G>
  );
}

/** Sprout, a seedling in a pot. The two leaves are the signal: reaching up when Good, wilted when Low. */
function Sprout({ mood }: FaceProps) {
  const LEAF = '#9cc49b';
  const LEAF2 = '#86b186';
  const leaves = {
    calm: (
      <G>
        <Path d="M16 32q-9-7-1-12q7 4 1 12z" fill={LEAF} />
        <Path d="M48 32q9-7 1-12q-7 4-1 12z" fill={LEAF2} />
      </G>
    ),
    good: (
      <G>
        <Path d="M15 28q-7-11 2-13q5 6-2 13z" fill={LEAF} />
        <Path d="M49 28q7-11-2-13q-5 6 2 13z" fill={LEAF2} />
      </G>
    ),
    stressed: (
      <G>
        <Path d="M15 33q-10-3-4-9q7 2 4 9z" fill={LEAF} />
        <Path d="M49 33q10-3 4-9q-7 2-4 9z" fill={LEAF2} />
      </G>
    ),
    low: (
      <G>
        <Path d="M16 36q-10 3-7-5q7-1 7 5z" fill="#aabfa6" />
        <Path d="M48 36q10 3 7-5q-7-1-7 5z" fill="#9db399" />
      </G>
    ),
  }[bodyMood(mood)];
  return (
    <G>
      {leaves}
      <Circle cx={32} cy={33} r={17} fill="#f1f6e6" />
      <Face mood={mood} />
      <Rect x={14} y={43} width={36} height={5.4} rx={2.7} fill="#ebb892" />
      <Path d="M16.5 48h31l-3 12q-12.5 3-25 0z" fill="#e0a97e" />
      {mood === 'good' && <Sparkle x={52} y={40} r={3.4} fill="#f0d27a" />}
      {mood === 'low' && <Path d="M50 58q6 1 7-3q-6-2-7 3z" fill="#bfb9a6" />}
    </G>
  );
}

/** Bun, a rabbit. The ears are the signal: straight up when Good, one back when Stressed, flopped when Low. */
function Bun({ mood }: FaceProps) {
  // Same reason as Bao: #f4ece2 was lighter than the background it sits on.
  const FUR = '#f0e4d4';
  const EDGE = '#dccbb4';
  const INNER = '#f3c6c6';
  const ears = {
    calm: (
      <G>
        <Path d="M19 26Q14 7 21 5Q28 9 27 26Z" fill={FUR} />
        <Path d="M45 26Q50 7 43 5Q36 9 37 26Z" fill={FUR} />
        <Path d="M21.5 24Q18.5 11 22 10Q25 13 24.5 24Z" fill={INNER} />
        <Path d="M42.5 24Q45.5 11 42 10Q39 13 39.5 24Z" fill={INNER} />
      </G>
    ),
    good: (
      <G>
        <Path d="M20 26Q12 8 20 4Q28 7 27 26Z" fill={FUR} />
        <Path d="M44 26Q52 8 44 4Q36 7 37 26Z" fill={FUR} />
        <Path d="M22 24Q17 11 21 9Q25 12 24.5 24Z" fill={INNER} />
        <Path d="M42 24Q47 11 43 9Q39 12 39.5 24Z" fill={INNER} />
      </G>
    ),
    stressed: (
      <G>
        <Path d="M19 26Q13 7 20 5Q28 9 27 26Z" fill={FUR} />
        <Path d="M44 27Q56 16 52 10Q42 13 37 26Z" fill={FUR} />
        <Path d="M21.5 24Q18 11 21.5 10Q25 13 24.5 24Z" fill={INNER} />
      </G>
    ),
    low: (
      <G>
        <Path d="M20 28Q5 27 4 35Q11 41 24 33Z" fill={FUR} />
        <Path d="M44 28Q59 27 60 35Q53 41 40 33Z" fill={FUR} />
        <Path d="M19 29Q9 29 8.5 34Q14 37 22 32Z" fill={INNER} />
      </G>
    ),
  }[bodyMood(mood)];
  return (
    <G>
      {ears}
      <Ellipse cx={32} cy={37} rx={18.5} ry={17.5} fill={FUR} stroke={EDGE} strokeWidth={1.4} />
      <Path d="M26 20q6-3 12 0" stroke="#d8c7ae" strokeWidth={2} strokeLinecap="round" fill="none" />
      <Face mood={mood} />
      <Path d="M30 36h4l-2 2.2z" fill="#e8998f" />
    </G>
  );
}

/* ---------------------------------- night shift ---------------------------------- */

/** Luna, the moon and Sunny's night half. Her sky is the signal: stars when Good, a cloud when Low. */
function Luna({ mood }: FaceProps) {
  const CRATER = '#ecd79a';
  return (
    <G>
      {mood === 'calm' && <Sparkle x={49} y={17} r={3.2} fill="#e8d9a8" />}
      {mood === 'good' && (
        <G>
          <Sparkle x={50} y={15} r={4} fill="#f3c14e" />
          <Sparkle x={13} y={15} r={3} fill="#f3c14e" />
          <Sparkle x={55} y={33} r={2.4} fill="#f3c14e" />
        </G>
      )}
      {mood === 'stressed' && (
        <Path d="M8 16l5 2M10 11l4 4" stroke="#ded3bb" strokeWidth={2} strokeLinecap="round" fill="none" />
      )}
      {mood === 'low' && <Cloud x={35} y={42} fill="#dfdbcf" />}
      <Circle cx={32} cy={34} r={19.5} fill={mood === 'low' ? '#f2e3b6' : '#f7e7b0'} />
      <Circle cx={17} cy={27} r={3.2} fill={CRATER} />
      <Circle cx={19.5} cy={44.5} r={2.2} fill={CRATER} />
      <Circle cx={46.5} cy={46} r={2.8} fill={CRATER} />
      <Circle cx={47} cy={24} r={1.8} fill={CRATER} />
      <Face mood={mood} />
    </G>
  );
}

/** Mochi, a round cat. Ears fold back when Stressed and droop when Low. */
function Mochi({ mood }: FaceProps) {
  const FUR = '#efe4d3';
  const ears = {
    calm: 'M14 26l3-14 12 8zM50 26l-3-14-12 8z',
    good: 'M14 26l3-14 12 8zM50 26l-3-14-12 8z',
    stressed: 'M13 28l-1-14 15 9zM51 28l1-14-15 9z',
    low: 'M12 30l1-11 15 7zM52 30l-1-11-15 7z',
  }[bodyMood(mood)];
  return (
    <G>
      <Path d={ears} fill={FUR} />
      {mood !== 'low' && <Path d="M17 24l2-8 7 5zM47 24l-2-8-7 5z" fill="#f4c2b8" />}
      <Ellipse cx={32} cy={36} rx={21} ry={18} fill={FUR} />
      <Path d="M26 18q6-3 12 0" stroke="#d9c7ad" strokeWidth={2} strokeLinecap="round" fill="none" />
      <Face mood={mood} />
      <Path d="M30 36.5h4l-2 2z" fill="#e8998f" />
      {mood === 'stressed' && (
        <Path d="M52 8v7M52 18v1" stroke={INK} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      )}
    </G>
  );
}

/** Honey, a honey-colored bear. Holds tea when Calm and a heart when Good. */
function Honey({ mood }: FaceProps) {
  const FUR = '#d9a55c';
  const MUZZLE = '#f3dcb4';
  return (
    <G>
      <Circle cx={16} cy={18} r={7} fill={FUR} />
      <Circle cx={48} cy={18} r={7} fill={FUR} />
      <Circle cx={16} cy={18} r={3.5} fill={MUZZLE} />
      <Circle cx={48} cy={18} r={3.5} fill={MUZZLE} />
      <Circle cx={32} cy={35} r={20} fill={FUR} />
      <Ellipse cx={32} cy={40} rx={9} ry={6.5} fill={MUZZLE} />
      <Ellipse cx={32} cy={35.5} rx={2.4} ry={1.7} fill={INK} />
      <Face mood={mood} />
      {mood === 'calm' && (
        <G x={43} y={44}>
          <Rect x={0} y={0} width={10} height={9} rx={2.5} fill="#f4efe6" stroke="#d8cfc2" strokeWidth={1} />
          <Path d="M10 2.5q4 0 4 3t-4 3" stroke="#d8cfc2" strokeWidth={2} fill="none" />
          <Path d="M3 -3q1-2 0-4M6.5 -3q1-2 0-4" stroke="#d8cfc2" strokeWidth={1.4} strokeLinecap="round" fill="none" />
        </G>
      )}
      {mood === 'good' && (
        <Path d="M50 44c0-3-4-4-5-1-1-3-5-2-5 1 0 3 5 6 5 6s5-3 5-6z" fill="#e88c8c" />
      )}
    </G>
  );
}

/** Boba, a cup of milk tea. The pearls are the signal: they float up when Good, flat on the bottom when Low. */
function Boba({ mood }: FaceProps) {
  const EDGE = '#e3d6c4';
  const pearls = {
    calm: [
      [22, 50],
      [31, 51],
      [40, 50],
      [26, 45],
      [37, 45],
    ],
    good: [
      [22, 50],
      [31, 51],
      [40, 50],
      [25, 43],
      [39, 42],
    ],
    stressed: [
      [21, 49],
      [30, 51],
      [39, 49],
      [27, 42],
      [36, 44],
    ],
    low: [
      [21, 51],
      [28, 52],
      [35, 52],
      [42, 51],
      [31, 48],
    ],
  }[bodyMood(mood)];
  return (
    <G>
      <Rect x={39} y={4} width={5.4} height={18} rx={2.7} fill="#cfe3d7" rotation={11} originX={41.7} originY={13} />
      <Path d="M12 21h40l-4.5 34q-15.5 5-31 0z" fill="#fbf5ec" stroke={EDGE} strokeWidth={1.4} />
      <Path d="M14 25.5h36l-4 29.5q-14 4-28 0z" fill="#e9cba6" />
      <Rect x={9} y={17} width={46} height={6.4} rx={3.2} fill="#fdf9f2" stroke={EDGE} strokeWidth={1.2} />
      {pearls.map(([x, y]) => (
        <Circle key={`${x}-${y}`} cx={x} cy={y} r={3} fill="#5b4636" />
      ))}
      {mood === 'stressed' && (
        <G>
          <Circle cx={24} cy={30} r={1.6} fill="#fff" opacity={0.7} />
          <Circle cx={43} cy={27} r={1.2} fill="#fff" opacity={0.7} />
        </G>
      )}
      <Face mood={mood} />
    </G>
  );
}

/** Pengu, a penguin. The flippers are the signal: thrown wide when Good, tucked tight when Low. */
function Pengu({ mood }: FaceProps) {
  const BODY = mood === 'low' ? '#5b6480' : '#48526e';
  const BEAK = '#f0a93f';
  const flippers = {
    calm: (
      <G>
        <Ellipse cx={10} cy={40} rx={5} ry={10} fill={BODY} />
        <Ellipse cx={54} cy={40} rx={5} ry={10} fill={BODY} />
      </G>
    ),
    good: (
      <G>
        <Ellipse cx={9} cy={30} rx={5} ry={10} fill={BODY} rotation={-32} originX={9} originY={30} />
        <Ellipse cx={55} cy={30} rx={5} ry={10} fill={BODY} rotation={32} originX={55} originY={30} />
      </G>
    ),
    stressed: (
      <G>
        <Ellipse cx={9} cy={36} rx={5} ry={10} fill={BODY} rotation={-16} originX={9} originY={36} />
        <Ellipse cx={55} cy={36} rx={5} ry={10} fill={BODY} rotation={16} originX={55} originY={36} />
      </G>
    ),
    low: (
      <G>
        <Ellipse cx={12} cy={45} rx={4.6} ry={10} fill={BODY} rotation={10} originX={12} originY={45} />
        <Ellipse cx={52} cy={45} rx={4.6} ry={10} fill={BODY} rotation={-10} originX={52} originY={45} />
      </G>
    ),
  }[bodyMood(mood)];
  return (
    <G>
      {flippers}
      <Ellipse cx={32} cy={36} rx={20} ry={19.5} fill={BODY} />
      <Ellipse cx={32} cy={34.5} rx={15.5} ry={15} fill="#fffdf8" />
      <Face mood={mood} />
      <Path d="M29.4 33.6h5.2l-2.6 3.2z" fill={BEAK} />
      <Path
        d="M21 54.5q-4 2.4 0.6 3.4h5.6q1.6-2-0.6-3.4zM37.4 54.5q-2.2 1.4-0.6 3.4h5.6q4.6-1 0.6-3.4z"
        fill={BEAK}
      />
    </G>
  );
}

/** Hedgie, a hedgehog. The spines are the signal: flared wide when Stressed, laid flat when Low. */
function Hedgie({ mood }: FaceProps) {
  const SPINE = mood === 'low' ? '#9b806a' : '#8a6a52';
  const SKIN = '#f6e6d2';
  const spines = {
    calm: 'M10 36L14 18L20 32L26 13L32 30L38 13L44 32L50 18L54 36Z',
    good: 'M10 36L14 17L20 32L26 11L32 30L38 11L44 32L50 17L54 36Z',
    stressed: 'M6 36L9 12L19 31L25 6L32 29L39 6L45 31L55 12L58 36Z',
    // Splayed out past the face silhouette (rx 18) as well as lowered: tucked any tighter and the
    // face ellipse covered them completely, leaving Low with no body signal.
    low: 'M5 36L10 24L17 30L23 17L32 28L41 17L47 30L54 24L59 36Z',
  }[bodyMood(mood)];
  return (
    <G>
      <Path d={spines} fill={SPINE} />
      <Circle cx={15} cy={33} r={4.4} fill={SKIN} />
      <Circle cx={49} cy={33} r={4.4} fill={SKIN} />
      <Ellipse cx={32} cy={38} rx={18} ry={17} fill={SKIN} />
      <Face mood={mood} />
      <Circle cx={32} cy={34.6} r={1.9} fill={INK} />
    </G>
  );
}

const CHARACTERS: Record<Mascot, (p: FaceProps) => React.JSX.Element> = {
  sunny: Sunny,
  bao: Bao,
  peachy: Peachy,
  puff: Puff,
  sprout: Sprout,
  bun: Bun,
  luna: Luna,
  mochi: Mochi,
  honey: Honey,
  boba: Boba,
  pengu: Pengu,
  hedgie: Hedgie,
};

/**
 * The character on duty, kept current while the screen stays mounted. A session left open across
 * 06:00 or 18:00 would otherwise keep drawing the outgoing shift; the AppState listener is what
 * actually carries this, since a timer that long does not survive the app being backgrounded.
 */
export function useMascotOnDuty(): Mascot {
  const [mascot, setMascot] = useState<Mascot>(() => mascotOnDuty());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handover = () => {
      setMascot(mascotOnDuty());
      timer = setTimeout(handover, msUntilNextShift());
    };

    timer = setTimeout(handover, msUntilNextShift());

    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      setMascot(mascotOnDuty());
      if (timer) clearTimeout(timer);
      timer = setTimeout(handover, msUntilNextShift());
    });

    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return mascot;
}

interface MoodMascotProps {
  mood: Mood;
  mascot?: Mascot;
  size?: number;
}

export function MoodMascot({ mood, mascot = mascotOnDuty(), size = 44 }: MoodMascotProps) {
  const Character = CHARACTERS[mascot];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Character mood={mood} />
    </Svg>
  );
}
