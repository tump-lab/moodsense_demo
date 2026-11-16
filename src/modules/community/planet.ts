/**
 * Layout math for the Community universe: where each mood's continent goes and how big it is, and
 * the rotation that turns it. Everything is in a 350x300 scene, scaled to the panel at draw
 * time. Sizes come from aggregate bucket counts only, and no position stands for a real place.
 * No React Native imports, so scripts/selfcheck-help.ts can run it under plain Node.
 */

export const SCENE_W = 350;
export const SCENE_H = 300;

/** A 3x3 rotation, row by row. Screen axes: x right, y down, z toward the viewer. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];
export type Vec3 = readonly [number, number, number];

function mul(a: Mat3, b: Mat3): Mat3 {
  const r = (i: number, j: number) => a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[j + 3]! + a[i * 3 + 2]! * b[j + 6]!;
  return [r(0, 0), r(0, 1), r(0, 2), r(1, 0), r(1, 1), r(1, 2), r(2, 0), r(2, 1), r(2, 2)];
}

/** Positive turns the facing side of the planet to the right. */
function rotY(t: number): Mat3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/** Positive turns the facing side of the planet downward. */
function rotX(t: number): Mat3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

function rotZ(t: number): Mat3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Tips a ring so it reads as an ellipse with its near side low, leaning slightly. */
export const RING_TILT: Mat3 = mul(rotZ(-0.28), rotX(0.24));

/**
 * Gram-Schmidt, because a rotation multiplied every frame slowly stops being one and the planet
 * would visibly shear after a few minutes on screen.
 */
function orthonormal(m: Mat3): Mat3 {
  const n = (v: number[]) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
    return v.map((x) => x / l);
  };
  const a = n([m[0], m[1], m[2]]);
  const d = a[0]! * m[3] + a[1]! * m[4] + a[2]! * m[5];
  const b = n([m[3] - d * a[0]!, m[4] - d * a[1]!, m[5] - d * a[2]!]);
  const c = [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  return [a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!];
}

/** A drag: turns about the screen's axes, so the surface follows the finger however the planet is tipped. */
export function dragRotation(m: Mat3, dx: number, dy: number): Mat3 {
  return orthonormal(mul(mul(rotY(dx), rotX(dy)), m));
}

export function rotate(m: Mat3, x: number, y: number, z: number): Vec3 {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/**
 * When nobody is touching it, a world eases its continents back toward the viewer and sways there,
 * instead of turning the only data on it out of sight half the time. `t` is seconds.
 */
export function homeRotation(m: Mat3, dt: number, t: number): Mat3 {
  const RATE = 0.9;
  const [x, y, z] = rotate(m, 0, 0, 1);
  // Round the far side the short way; x moves against the turn back there.
  if (z < 0) return dragRotation(m, (x >= 0 ? -1 : 1) * RATE * dt, 0);
  const targetX = 0.16 * Math.sin(t * 0.25);
  const targetY = 0.05 * Math.sin(t * 0.17);
  return dragRotation(m, (targetX - x) * RATE * dt, (targetY - y) * RATE * dt);
}

/** The world's place in the scene. */
export const WORLD = { x: 175, y: 150, r: 100, ringR: 140 } as const;

export interface WorldLand {
  group: number;
  /** Centre on the sphere, and two directions across the surface there. */
  v: Vec3;
  u: Vec3;
  w: Vec3;
  /** Half-widths along u and w, in radians. */
  a: number;
  b: number;
}

/** Shapes for a typical mix, by bucket. Each scales with its share; the clamp keeps continents from running together. */
const LAND_SHAPES = [
  { group: 2, c: [-0.5, -0.3], a: 0.6, b: 0.37, rot: 0.55, share: 0.32 },
  { group: 1, c: [0.3, -0.6], a: 0.56, b: 0.35, rot: -0.28, share: 0.29 },
  { group: 0, c: [0.46, 0.26], a: 0.42, b: 0.52, rot: 0.35, share: 0.28 },
  { group: 3, c: [-0.34, 0.6], a: 0.36, b: 0.21, rot: -0.4, share: 0.11 },
  { group: 4, c: [0.0, 0.05], a: 0.3, b: 0.22, rot: 0.9, share: 0.12 },
] as const;

const crossV = (p: Vec3, q: Vec3): Vec3 => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
];
const unit = (p: Vec3): Vec3 => {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
};

/** A continent per mood with anyone in it, on one world. */
export function worldLands(counts: number[]): WorldLand[] {
  const live = counts.map((c) => (Number.isFinite(c) && c > 0 ? c : 0));
  const total = live.reduce((x, y) => x + y, 0);
  if (total === 0) return [];
  return LAND_SHAPES.flatMap((shape) => {
    const count = live[shape.group] ?? 0;
    if (count === 0) return [];
    const k = Math.min(1.3, Math.max(0.55, Math.sqrt(count / total / shape.share)));
    const v: Vec3 = [shape.c[0], shape.c[1], Math.sqrt(1 - shape.c[0] ** 2 - shape.c[1] ** 2)];
    const e1 = unit(crossV([0, 1, 0], v));
    const e2 = crossV(v, e1);
    const c = Math.cos(shape.rot);
    const s = Math.sin(shape.rot);
    return [
      {
        group: shape.group,
        v,
        u: [c * e1[0] + s * e2[0], c * e1[1] + s * e2[1], c * e1[2] + s * e2[2]] as Vec3,
        w: [-s * e1[0] + c * e2[0], -s * e1[1] + c * e2[1], -s * e1[2] + c * e2[2]] as Vec3,
        a: shape.a * k,
        b: shape.b * k,
      },
    ];
  });
}

export interface BackgroundPlanet {
  x: number;
  y: number;
  r: number;
  band: boolean;
  ring: boolean;
  seed: number;
}

/** Small plain planets that make the scene a universe. They carry no data, so they never glow, sparkle or get a label. */
export const BACKGROUND_PLANETS: BackgroundPlanet[] = [
  { x: 26, y: 30, r: 11, band: false, ring: false, seed: 21 },
  { x: 314, y: 40, r: 13, band: true, ring: true, seed: 24 },
  { x: 330, y: 124, r: 6, band: false, ring: false, seed: 22 },
  { x: 18, y: 136, r: 7, band: false, ring: false, seed: 25 },
  { x: 28, y: 264, r: 10, band: false, ring: false, seed: 26 },
  { x: 322, y: 262, r: 12, band: true, ring: false, seed: 23 },
  { x: 96, y: 284, r: 6, band: true, ring: false, seed: 27 },
];

/** Where the twinkles sit: [x, y, size, phase]. Clear of the world's land. */
export const SPARKLES: [number, number, number, number][] = [
  [48, 84, 15, 0],
  [70, 36, 12, 0.27],
  [158, 18, 11, 0.54],
  [294, 96, 16, 0.12],
  [330, 206, 12, 0.73],
  [66, 182, 13, 0.42],
  [222, 282, 13, 0.19],
  [292, 258, 11, 0.81],
  [24, 62, 9, 0.35],
  [118, 40, 8, 0.63],
  [212, 30, 10, 0.9],
  [262, 58, 8, 0.05],
  [338, 82, 9, 0.48],
  [22, 212, 10, 0.58],
  [56, 252, 8, 0.31],
  [120, 276, 9, 0.68],
  [178, 290, 7, 0.95],
  [262, 272, 8, 0.38],
  [96, 18, 7, 0.12],
  [250, 14, 8, 0.76],
  [306, 14, 7, 0.44],
  [14, 100, 7, 0.22],
  [344, 156, 8, 0.66],
  [340, 240, 7, 0.09],
  [14, 176, 7, 0.84],
  [148, 296, 6, 0.51],
  [232, 296, 7, 0.29],
  [40, 290, 7, 0.6],
];

/** The ring's near and far halves as SVG paths. */
export function ringPaths(m: Mat3, cx: number, cy: number, radius: number): { front: string; back: string } {
  const SEGMENTS = 72;
  let front = '';
  let back = '';
  let prev: { x: number; y: number; near: boolean } | null = null;
  for (let i = 0; i <= SEGMENTS; i += 1) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    const [x, y, z] = rotate(m, Math.cos(a), 0, Math.sin(a));
    const cur = { x: cx + x * radius, y: cy + y * radius, near: z >= 0 };
    if (prev) {
      const seg = `M${prev.x.toFixed(1)} ${prev.y.toFixed(1)}L${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`;
      if (cur.near) front += seg;
      else back += seg;
    }
    prev = cur;
  }
  return { front, back };
}
