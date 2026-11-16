/**
 * Pure streak math with no React Native / Expo imports, so it runs in plain Node (see scripts/selfcheck-phq4.ts).
 * `Mood` is a type-only import, so expo-sqlite is never loaded at runtime.
 */
import type { Mood } from '../../services/db';

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

/**
 * Number of consecutive days with a check-in, counting back from `today`.
 * A streak is still alive if its latest day is today or yesterday; duplicate and unsorted dates are fine.
 */
export function computeStreak(dates: string[], today: string): number {
  if (dates.length === 0) return 0;

  const have = new Set(dates);
  const todayMs = toUtcMs(today);

  let cursor: number;
  if (have.has(today)) {
    cursor = todayMs;
  } else {
    const yesterday = fromUtcMs(todayMs - DAY_MS);
    if (!have.has(yesterday)) return 0;
    cursor = todayMs - DAY_MS;
  }

  let streak = 0;
  while (have.has(fromUtcMs(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DatedCheckin {
  date: string;
  mood: Mood;
  ts: number;
}
