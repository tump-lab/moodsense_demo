/**
 * The tree that stands for the growth level — six drawings, one per tier, picked by `stage`.
 *
 * Hand-placed rather than generated: a tree grown by a formula reads as a circle getting bigger,
 * and the point of the drawing is that each level looks like a different plant, not a rescaled one.
 * Drawn with react-native-svg, like the rest of the app's illustrations.
 */
import React from 'react';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';
import { colors } from '../../theme';

/** Everything below is placed in this box; `size` only scales the result. */
const VB = 120;
const GROUND_Y = 104;

interface Blob {
  cx: number;
  cy: number;
  r: number;
}

interface TreeShape {
  /** Trunk height above the ground line; 0 draws no trunk. */
  trunk: number;
  canopy: Blob[];
  /** Two seed leaves instead of a canopy, for the sprout. */
  seedLeaves: boolean;
  blossoms: Blob[];
}

const STAGES: readonly TreeShape[] = [
  // 0 — Seed: nothing above ground yet but the mound it is under.
  { trunk: 0, canopy: [], seedLeaves: false, blossoms: [] },
  // 1 — Sprout
  { trunk: 20, canopy: [], seedLeaves: true, blossoms: [] },
  // 2 — Sapling
  { trunk: 34, canopy: [{ cx: 60, cy: 62, r: 16 }], seedLeaves: false, blossoms: [] },
  // 3 — Young tree
  {
    trunk: 44,
    canopy: [
      { cx: 60, cy: 52, r: 18 },
      { cx: 44, cy: 62, r: 13 },
      { cx: 76, cy: 62, r: 13 },
    ],
    seedLeaves: false,
    blossoms: [],
  },
  // 4 — Full tree
  {
    trunk: 52,
    canopy: [
      { cx: 60, cy: 44, r: 21 },
      { cx: 40, cy: 56, r: 15 },
      { cx: 80, cy: 56, r: 15 },
      { cx: 49, cy: 32, r: 12 },
      { cx: 72, cy: 32, r: 12 },
    ],
    seedLeaves: false,
    blossoms: [],
  },
  // 5 — In blossom: the same crown, flowering.
  {
    trunk: 52,
    canopy: [
      { cx: 60, cy: 44, r: 21 },
      { cx: 40, cy: 56, r: 15 },
      { cx: 80, cy: 56, r: 15 },
      { cx: 49, cy: 32, r: 12 },
      { cx: 72, cy: 32, r: 12 },
    ],
    seedLeaves: false,
    blossoms: [
      { cx: 47, cy: 40, r: 3.5 },
      { cx: 70, cy: 26, r: 3 },
      { cx: 82, cy: 52, r: 3.5 },
      { cx: 36, cy: 58, r: 3 },
      { cx: 62, cy: 56, r: 3.5 },
      { cx: 58, cy: 28, r: 3 },
    ],
  },
];

const TRUNK_W = 7;

export function GrowthTree({ stage, size = 104 }: { stage: number; size?: number }) {
  const shape = STAGES[Math.min(Math.max(0, Math.round(stage)), STAGES.length - 1)]!;
  const trunkTop = GROUND_Y - shape.trunk;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      {/* Soil, so a seed with nothing above ground still reads as planted rather than empty. */}
      <Path
        d={`M24 ${GROUND_Y} Q60 ${GROUND_Y - 10} 96 ${GROUND_Y}`}
        stroke={colors.line}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
      {shape.trunk === 0 ? (
        <Circle cx={60} cy={GROUND_Y - 5} r={5} fill={colors.amber} />
      ) : (
        <Rect
          x={60 - TRUNK_W / 2}
          y={trunkTop}
          width={TRUNK_W}
          height={shape.trunk}
          rx={TRUNK_W / 2}
          fill={colors.amber}
        />
      )}

      {shape.seedLeaves && (
        <>
          <Ellipse cx={46} cy={trunkTop + 4} rx={13} ry={8} fill={colors.primary} />
          <Ellipse cx={74} cy={trunkTop + 4} rx={13} ry={8} fill={colors.primaryDeep} />
        </>
      )}

      {/* The branches up into the crown, drawn under it so only the stubs show. */}
      {shape.canopy.length > 1 &&
        shape.canopy.map((blob) => (
          <Line
            key={`branch-${blob.cx}-${blob.cy}`}
            x1={60}
            y1={trunkTop + 10}
            x2={blob.cx}
            y2={blob.cy}
            stroke={colors.amber}
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}

      {shape.canopy.map((blob, i) => (
        <Circle
          key={`canopy-${blob.cx}-${blob.cy}`}
          cx={blob.cx}
          cy={blob.cy}
          r={blob.r}
          // Alternating tones give the crown some depth without a gradient.
          fill={i % 2 === 0 ? colors.primary : colors.primaryDeep}
          opacity={i % 2 === 0 ? 1 : 0.85}
        />
      ))}

      {shape.blossoms.map((blob) => (
        <Circle
          key={`blossom-${blob.cx}-${blob.cy}`}
          cx={blob.cx}
          cy={blob.cy}
          r={blob.r}
          fill={colors.rose}
        />
      ))}
    </Svg>
  );
}
