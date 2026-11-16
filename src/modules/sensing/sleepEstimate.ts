/**
 * Wearable-free sleep estimate: the longest overnight gap in screen activity (last
 * screen_off to first screen_on) is a standard research proxy for the sleep window. It is
 * a separate stream from measured sleep so an estimate is never mistaken for real data.
 */
import { isSessionEnd, isSessionStart, type ScreenEvent } from './screenSessions';
import { nightDateForTs } from './sleepNights';

export interface EstimatedSleepNight {
  date: string;
  onsetTs: number;
  wakeTs: number;
  totalAsleepMs: number;
  estimated: true;
  method: 'screen_gap';
}

export interface SleepEstimateOptions {
  minGapMs?: number;
  maxGapMs?: number;
}

const DEFAULT_MIN_GAP_MS = 3 * 60 * 60_000;
const DEFAULT_MAX_GAP_MS = 14 * 60 * 60_000;

/**
 * A gap counts as overnight if its midpoint falls between 9pm and 11am local, a generous
 * span of normal sleep midpoints. A midday gap of the same length fails this.
 */
function isOvernight(startTs: number, endTs: number): boolean {
  const mid = new Date((startTs + endTs) / 2);
  const h = mid.getHours();
  return h >= 21 || h < 11;
}

export function deriveSleepEstimates(
  events: ScreenEvent[],
  options: SleepEstimateOptions = {},
): EstimatedSleepNight[] {
  const minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS;
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;

  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const bestByNight = new Map<string, EstimatedSleepNight>();

  let lastOff: number | null = null;
  for (const e of sorted) {
    if (isSessionEnd(e.type)) {
      // Consecutive offs: keep the latest. A lock counts too, since locking the phone and
      // putting it down is the stronger signal.
      lastOff = e.ts;
      continue;
    }
    // Only a screen coming back on ends the night; a stray event type must not close the gap.
    if (!isSessionStart(e.type)) continue;
    if (lastOff == null) continue;
    const gapMs = e.ts - lastOff;
    const startTs = lastOff;
    lastOff = null;
    if (gapMs < minGapMs || gapMs > maxGapMs) continue;
    if (!isOvernight(startTs, e.ts)) continue;

    // The gap's midpoint decides which night it belongs to, so a 4am onset lands on the
    // previous evening's night.
    const date = nightDateForTs((startTs + e.ts) / 2);
    const existing = bestByNight.get(date);
    if (!existing || gapMs > existing.totalAsleepMs) {
      bestByNight.set(date, {
        date,
        onsetTs: startTs,
        wakeTs: e.ts,
        totalAsleepMs: gapMs,
        estimated: true,
        method: 'screen_gap',
      });
    }
  }

  return [...bestByNight.values()].sort((a, b) => a.date.localeCompare(b.date));
}
