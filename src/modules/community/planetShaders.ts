/**
 * The Community universe's look, as Skia shaders: real light, fog and soft coasts that SVG cannot do,
 * cheap enough to turn with a finger. Compiled once, on first use.
 */
import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';

const NOISE = `
float h3(float3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise(float3 p) {
  float3 i = floor(p);
  float3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h3(i), h3(i + float3(1, 0, 0)), f.x), mix(h3(i + float3(0, 1, 0)), h3(i + float3(1, 1, 0)), f.x), f.y),
    mix(mix(h3(i + float3(0, 0, 1)), h3(i + float3(1, 0, 1)), f.x), mix(h3(i + float3(0, 1, 1)), h3(i + float3(1, 1, 1)), f.x), f.y),
    f.z);
}
float octave(float3 p, int count) {
  float a = 0.5;
  float s = 0.0;
  float t = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= count) { break; }
    s += a * noise(p);
    t += a;
    // Turning each octave off the lattice is what stops the noise looking blocky.
    p = float3((p.x * 0.8 - p.y * 0.6) * 2.03 + 11.3, (p.x * 0.6 + p.y * 0.8) * 2.03 + 7.1, p.z * 2.03 + 3.7);
    a *= 0.5;
  }
  return s / t;
}
`;

const SPHERE = `
const float3 LIGHT = float3(-0.5, -0.5, 0.707);
float3 lightHalf() { return normalize(LIGHT + float3(0, 0, 1)); }
`;

const SKY = `
uniform float scale;
uniform float3 base;
uniform float3 cloudA;
uniform float3 cloudB;
uniform float3 cloudC;
${NOISE}
/** One grid of stars: most cells are empty, the rest hold a single point at a random spot. */
float stars(float2 v, float cell, float density, float size, float layer) {
  float2 g = floor(v / cell);
  float h = h3(float3(g, layer));
  if (h < 1.0 - density) { return 0.0; }
  float2 at = 0.15 + 0.7 * float2(h3(float3(g, layer + 1.0)), h3(float3(g, layer + 2.0)));
  float r = size * (0.6 + 0.8 * h3(float3(g, layer + 3.0)));
  float dist = length((fract(v / cell) - at) * cell);
  return (1.0 - smoothstep(0.0, r, dist)) * (0.45 + 0.55 * h3(float3(g, layer + 4.0)));
}
half4 main(float2 xy) {
  float2 v = xy / scale;
  float a = octave(float3(v.x / 105.0 + 1.0, v.y / 105.0 + 4.0, 1.1), 5);
  float b = octave(float3(v.x / 75.0 + 8.0, v.y / 95.0 + 2.0, 3.3), 5);
  float c = octave(float3(v.x / 130.0 + 5.0, v.y / 65.0 + 7.0, 6.1), 4);
  float off = v.y - (270.0 - v.x * 0.75);
  float band = exp(-(off * off) / (130.0 * 130.0));
  float3 col = base;
  col = mix(col, cloudA, 0.8 * smoothstep(0.4, 0.72, a) * (0.45 + 0.55 * band));
  col = mix(col, cloudB, 0.64 * smoothstep(0.46, 0.76, b) * (0.4 + 0.6 * band));
  col = mix(col, cloudC, 0.56 * smoothstep(0.5, 0.76, c));
  // The sky is pale, so stars tint it instead of adding light: fine gold dust, rose and lilac flecks, bright gold points.
  float dust = stars(v, 5.0, 0.42, 0.75, 20.0);
  float mid = stars(v, 13.0, 0.5, 1.0, 30.0);
  float bright = stars(v, 34.0, 0.55, 1.7, 40.0);
  float tint = h3(float3(floor(v / 13.0), 31.0));
  col = mix(col, float3(0.86, 0.68, 0.25), dust * 0.6);
  col = mix(col, tint < 0.5 ? float3(0.89, 0.6, 0.74) : float3(0.64, 0.58, 0.88), mid * 0.85);
  col = mix(col, float3(0.9, 0.7, 0.2), bright);
  // A touch of dither, or these gradients band on a phone screen.
  col += (h3(float3(xy, 9.0)) - 0.5) * 1.6 / 255.0;
  return half4(col, 1.0);
}
`;

const SMALL_PLANET = `
uniform float2 center;
uniform float radius;
uniform float3 lightColor;
uniform float3 darkColor;
uniform float band;
uniform float seed;
uniform float haze;
${NOISE}
${SPHERE}
half4 main(float2 xy) {
  float2 d = (xy - center) / radius;
  float rr = length(d);
  float z = sqrt(max(0.0, 1.0 - rr * rr));
  float3 n = float3(d, z);
  float lit = smoothstep(-0.25, 0.85, dot(n, normalize(LIGHT)));
  float tex = band > 0.5
    ? 0.5 + 0.5 * sin((d.y + 0.3 * d.x) * (7.0 + mod(seed, 3.0)) + (octave(float3(d * 1.5 + seed, 1.0), 3) - 0.5) * 3.0)
    : octave(float3(d * 2.6 + seed, z * 2.6), 4);
  float3 col = mix(darkColor, lightColor, clamp(lit * (0.72 + 0.42 * tex), 0.0, 1.0));
  float a = clamp((1.0 - rr) * radius + 0.5, 0.0, 1.0) * haze;
  return half4(col * a, a);
}
`;

/** One planet of separate continents with soft coasts that melt into the sea. */
const WORLD_PLANET = `
uniform float2 center;
uniform float radius;
uniform float3 r0;
uniform float3 r1;
uniform float3 r2;
uniform float3 seaLight;
uniform float3 seaDark;
uniform float3 seaCloud;
uniform float3 rimColor;
uniform float3 v0; uniform float3 u0; uniform float3 w0; uniform float2 ab0; uniform float3 c0;
uniform float3 v1; uniform float3 u1; uniform float3 w1; uniform float2 ab1; uniform float3 c1;
uniform float3 v2; uniform float3 u2; uniform float3 w2; uniform float2 ab2; uniform float3 c2;
uniform float3 v3; uniform float3 u3; uniform float3 w3; uniform float2 ab3; uniform float3 c3;
uniform float3 v4; uniform float3 u4; uniform float3 w4; uniform float2 ab4; uniform float3 c4;
${NOISE}
${SPHERE}
float land(float3 local, float3 warped, float3 q, float3 v, float3 u, float3 w, float2 ab, float off) {
  if (ab.x <= 0.0) { return 9.0; }
  float du = dot(warped - v, u);
  float dw = dot(warped - v, w);
  float back = dot(local, v) > 0.0 ? 0.0 : 3.0;
  return length(float2(du / (ab.x * 0.86), dw / (ab.y * 0.86))) + back
    + (octave(float3(q.x * 0.8 + off, q.y * 0.8 + off, q.z * 0.8), 3) - 0.5) * 0.8;
}
half4 main(float2 xy) {
  float2 d = (xy - center) / radius;
  float rr = length(d);
  if (rr > 1.02) { return half4(0.0); }
  float z = sqrt(max(0.0, 1.0 - rr * rr));
  float3 n = float3(d, z);
  float3 local = r0 * n.x + r1 * n.y + r2 * n.z;
  float3 q = local * 2.0 + 5.0;
  float nl = dot(n, normalize(LIGHT));
  float3 warped = local + 0.34 * (float3(
    octave(q * 0.55, 3),
    octave(q * 0.55 + float3(5.1, 2.3, 7.7), 3),
    octave(q * 0.55 + float3(10.2, 4.6, 15.4), 3)) - 0.5);
  float dd[5];
  dd[0] = land(local, warped, q, v0, u0, w0, ab0, 0.0);
  dd[1] = land(local, warped, q, v1, u1, w1, ab1, 3.7);
  dd[2] = land(local, warped, q, v2, u2, w2, ab2, 7.4);
  dd[3] = land(local, warped, q, v3, u3, w3, ab3, 11.1);
  dd[4] = land(local, warped, q, v4, u4, w4, ab4, 14.8);
  float d1 = 9.0;
  float d2 = 9.0;
  float3 mood = c0;
  float3 colors[5];
  colors[0] = c0; colors[1] = c1; colors[2] = c2; colors[3] = c3; colors[4] = c4;
  for (int i = 0; i < 5; i++) {
    if (dd[i] < d1) { d2 = d1; d1 = dd[i]; mood = colors[i]; }
    else if (dd[i] < d2) { d2 = dd[i]; }
  }
  float m = smoothstep(1.3, 0.7, d1) * smoothstep(0.0, 0.4, d2 - d1);
  float shallow = smoothstep(1.9, 0.95, d1) * smoothstep(0.0, 0.7, d2 - d1);
  float lit = 0.88 + 0.12 * smoothstep(-0.4, 0.95, nl);
  float3 sea = mix(seaDark, seaLight, pow(clamp(nl * 0.5 + 0.5, 0.0, 1.0), 1.3));
  float cloud = smoothstep(0.44, 0.8, octave(float3(local.x * 1.4 + 2.0, local.y * 2.4 + 4.0, local.z * 1.4 + 6.0), 3));
  sea = mix(sea, seaCloud, cloud * 0.5);
  sea = mix(sea, mood, shallow * 0.26);
  float pig = octave(q * 0.8, 3);
  float3 ink = mix(mood, float3(1.0, 0.99, 0.96), smoothstep(0.4, 0.72, pig) * 0.34);
  float3 col = mix(sea, ink, m * 0.88) * lit;
  float veil = smoothstep(0.5, 0.82, octave(float3(local.x * 1.3 + 7.0, local.y * 2.6 + 1.0, local.z * 1.3 + 3.0), 4));
  col = mix(col, float3(1.0, 0.995, 0.975), veil * 0.42);
  col += pow(clamp(dot(n, lightHalf()), 0.0, 1.0), 30.0) * 0.1;
  col = mix(col, rimColor, clamp(pow(1.0 - z, 2.6) * 0.5, 0.0, 1.0));
  float a = clamp((1.0 - rr) * radius + 0.5, 0.0, 1.0);
  return half4(clamp(col, 0.0, 1.0) * a, a);
}
`;

function compile(source: string): SkRuntimeEffect {
  const effect = Skia.RuntimeEffect.Make(source);
  if (!effect) throw new Error('A Community planet shader failed to compile');
  return effect;
}

let compiled: { sky: SkRuntimeEffect; small: SkRuntimeEffect; world: SkRuntimeEffect } | null = null;

export function planetShaders() {
  compiled ??= {
    sky: compile(SKY),
    small: compile(SMALL_PLANET),
    world: compile(WORLD_PLANET),
  };
  return compiled;
}
