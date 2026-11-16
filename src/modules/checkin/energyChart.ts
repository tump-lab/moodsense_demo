/**
 * Pure layout math for the day's mood trajectory line, drawn on Home and inside each Insights weekly column.
 * No React imports, so scripts/selfcheck-energy-chart.ts can run it under plain Node.
 */
import type { Mood } from '../../services/db';
import { MOOD_ORDER } from './moods';

export interface EnergyPoint {
  ts: number;
  mood: Mood;
}

/**
 * Vertical order is MOOD_ORDER's, top to bottom, chosen for readability, not as a ranking of the moods.
 */
export function moodAxisFraction(mood: Mood): number {
  const idx = MOOD_ORDER.indexOf(mood);
  const denom = Math.max(1, MOOD_ORDER.length - 1);
  return idx < 0 ? 0.5 : idx / denom;
}

export function timeOfDayFraction(ts: number): number {
  const d = new Date(ts);
  const secondsIntoDay = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  return secondsIntoDay / 86400;
}

/**
 * Picks indices evenly across the list, keeping the first and last entry, so the drawn line still shows the shape of the whole day.
 */
export function capPoints<T>(entries: T[], max: number): T[] {
  if (max <= 0) return [];
  if (entries.length <= max) return entries;
  if (max === 1) return [entries[entries.length - 1]!];
  const picked: T[] = [];
  const step = (entries.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const entry = entries[Math.round(i * step)];
    // Not a truthiness check: T is unconstrained, so 0 or '' is a real value to keep.
    if (entry !== undefined) picked.push(entry);
  }
  return picked;
}

export function chronological(entries: EnergyPoint[]): EnergyPoint[] {
  return [...entries].sort((a, b) => a.ts - b.ts);
}

export interface LaidOutPoint {
  cx: number;
  cy: number;
  ts: number;
  mood: Mood;
}

export interface EnergyLayoutOptions {
  width: number;
  height: number;
  marker: number;
  minGap: number;
}

/**
 * x comes from clock time, but check-ins in the same minute would stack into a blob, so a declutter pass pushes neighbours apart to `minGap` (left-to-right, then back right-to-left if the last marker overflows).
 * Order is always kept, and exact times stay available on tap.
 */
export function layoutEnergyPoints(
  entries: EnergyPoint[],
  opts: EnergyLayoutOptions
): LaidOutPoint[] {
  const { width, height, marker, minGap } = opts;
  if (entries.length === 0 || width <= 0 || height <= 0) return [];

  const ordered = chronological(entries);
  const minX = marker / 2;
  const maxX = Math.max(minX, width - marker / 2);
  const span = maxX - minX;

  const points: LaidOutPoint[] = ordered.map((entry) => ({
    cx: minX + timeOfDayFraction(entry.ts) * span,
    cy: marker / 2 + moodAxisFraction(entry.mood) * Math.max(0, height - marker),
    ts: entry.ts,
    mood: entry.mood,
  }));

  if (minGap * (points.length - 1) > span) {
    const step = points.length > 1 ? span / (points.length - 1) : 0;
    return points.map((p, i) => ({ ...p, cx: minX + i * step }));
  }

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const p = points[i]!;
    if (p.cx - prev.cx < minGap) p.cx = prev.cx + minGap;
  }
  const overflow = points[points.length - 1]!.cx - maxX;
  if (overflow > 0) {
    points[points.length - 1]!.cx = maxX;
    for (let i = points.length - 2; i >= 0; i--) {
      const next = points[i + 1]!;
      const p = points[i]!;
      if (next.cx - p.cx < minGap) p.cx = next.cx - minGap;
    }
  }
  return points;
}

export function energySummary(
  entries: EnergyPoint[],
  labels: Record<Mood, string>,
  formatTime: (ts: number) => string
): string {
  if (entries.length === 0) return 'No check-ins yet today.';
  const ordered = chronological(entries);
  const latest = ordered[ordered.length - 1]!;
  const count =
    entries.length === 1 ? '1 check-in today' : `${entries.length} check-ins today`;
  return `${count}, most recently ${labels[latest.mood]} at ${formatTime(latest.ts)}.`;
}
