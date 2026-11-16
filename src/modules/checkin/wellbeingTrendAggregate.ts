/**
 * The pure half of the Home trend card's loader: folds the rows wellbeingTrendData reads from SQLite into one
 * DayInputs per date. No React Native, Expo or SQLite imports, so plain Node can run the exact aggregation the
 * phone runs.
 */
import type { Mood } from '../../services/db';
import { EMPTY_PHYSICAL, localDateKey, nextDayKey, type DayInputs, type DayPhysical } from './wellbeingTrend';

/** Fewest raw readings a day needs before its low percentile is worth calling a resting rate. */
const MIN_HR_SAMPLES = 20;
/** How far up the sorted day the estimate sits: low, but not the single lowest reading. */
const RESTING_HR_PERCENTILE = 0.1;

function parsePayload(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export const PHYSICAL_STREAMS = [
  'steps',
  'steps_foreground',
  'health_steps_daily',
  // By volume these two are most of what the phone actually records — one row an hour each, against
  // a handful a day for everything else — and the card read neither. `steps_hourly` is the only
  // full-day step count a phone without a health platform ever produces, so "Steps not recorded"
  // was being shown on days with 96 hourly rows sitting in the table.
  'steps_hourly',
  'activity_os',
  'sleep_night',
  'sleep_night_estimated',
  'app_usage',
  // iOS writes this instead of `app_usage`: a daily threshold crossing, not a duration. Without it
  // the screen feature was permanently null on iPhone — the model read every day as ordinary while
  // the You tab showed the participant "7h+" from these very rows.
  'app_usage_threshold',
  'health_resting_hr',
  // A watch that writes only raw heart rate — which is most of them; Apple's own resting figure and
  // resting figure comes from the Watch, not from a third-party strap. Without this restingHr was
  // null on every single day for anyone using one, while thousands of samples sat in the table.
  'health_heart_rate',
] as const;

interface DayAccum {
  steps: number | null;
  /** Highest step count seen per hour bucket, keyed by hourStart: summed into a day total. */
  hourlySteps: Map<number, number>;
  /** Minutes classified as walking, running or cycling, likewise per hour bucket. */
  hourlyActive: Map<number, number>;
  appSteps: number | null;
  healthSteps: number | null;
  sleepMs: number | null;
  sleepEstimateMs: number | null;
  screen: { ts: number; ms: number } | null;
  /** Highest whole-phone threshold crossed that day, in minutes. iOS only. */
  totalThresholdMin: number | null;
  unlocks: number | null;
  hr: number[];
  /** Every raw bpm reading of the day, for the resting estimate below. */
  hrAll: number[];
}

function emptyAccum(): DayAccum {
  return {
    steps: null,
    hourlySteps: new Map(),
    hourlyActive: new Map(),
    appSteps: null,
    healthSteps: null,
    sleepMs: null,
    sleepEstimateMs: null,
    screen: null,
    totalThresholdMin: null,
    unlocks: null,
    hr: [],
    hrAll: [],
  };
}

const maxOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

/**
 * Steps prefer the device's full-day count (iOS `steps`, then Health), falling back to the Android app-open count, which
 * is partial but is still the best signal a motion-only Android participant has.
 */
function toPhysical(a: DayAccum | undefined): DayPhysical {
  if (!a) return EMPTY_PHYSICAL;
  const sleepMs = a.sleepMs ?? a.sleepEstimateMs;
  const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);
  // Android's real total wins; iOS has only the threshold floor, which still beats the null that
  // the feature vector reads as "an ordinary day".
  const screenHours =
    a.screen != null
      ? a.screen.ms / 3_600_000
      : a.totalThresholdMin != null
        ? a.totalThresholdMin / 60
        : null;
  /**
   * The quiet end of a day's heart rate, as a stand-in for a resting figure the platform never
   * wrote. A low percentile rather than the minimum, so one artefact cannot define the day, and
   * only over enough samples for that percentile to mean anything.
   */
  const restingFrom = (xs: number[]): number | null => {
    if (xs.length < MIN_HR_SAMPLES) return null;
    const sorted = [...xs].sort((x, y) => x - y);
    return sorted[Math.floor((sorted.length - 1) * RESTING_HR_PERCENTILE)]!;
  };

  const sumOf = (m: Map<number, number>) =>
    m.size === 0 ? null : [...m.values()].reduce((t, v) => t + v, 0);
  // The hourly roll-up wins over the sparse `steps` rows: it is a real whole-day count built from
  // one row an hour, where `steps` is whatever the collector last happened to read.
  const hourly = sumOf(a.hourlySteps);
  // Apple's own resting figure wins whenever the platform wrote one; the estimate only fills the
  // gap left by a watch that reports raw heart rate and nothing else.
  const measuredResting = mean(a.hr);
  const estimatedResting = measuredResting == null ? restingFrom(a.hrAll) : null;
  return {
    steps: hourly ?? a.steps ?? a.healthSteps ?? a.appSteps,
    activeMinutes: sumOf(a.hourlyActive),
    restingHrIsEstimated: measuredResting == null && estimatedResting != null,
    sleepHours: sleepMs == null ? null : sleepMs / 3_600_000,
    screenHours,
    unlocks: a.unlocks,
    restingHr: measuredResting ?? estimatedResting,
    screenHoursIsFloor: a.screen == null && a.totalThresholdMin != null,
  };
}

/** The rows loadHistory reads, already filtered by its SQL. */
export interface HistoryRows {
  checkins: Array<{ date: string; mood: Mood }>;
  phq4: Array<{ ts: number; total: number }>;
  chats: Array<{ ts: number; content: string | null; transcript: string | null }>;
  /** Rows from PHYSICAL_STREAMS only. */
  sensing: Array<{ stream: string; ts: number; payload: string }>;
  /** OS-level screen_unlock rows only (see the unlock query in wellbeingTrendData). */
  unlockRows: Array<{ ts: number }>;
}

/** One DayInputs per entry of `dates`, oldest first, in the same order. */
export function assembleHistory(dates: string[], rows: HistoryRows): DayInputs[] {
  const { checkins, phq4, chats, sensing, unlockRows } = rows;
  const byDay = new Map<string, DayInputs>(
    dates.map((date) => [date, { date, moods: [], phq4Totals: [], messages: [], physical: EMPTY_PHYSICAL }])
  );
  const accum = new Map<string, DayAccum>();
  const acc = (date: string) => {
    let a = accum.get(date);
    if (!a) {
      a = emptyAccum();
      accum.set(date, a);
    }
    return a;
  };

  for (const c of checkins) byDay.get(c.date)?.moods.push(c.mood);
  for (const p of phq4) byDay.get(localDateKey(new Date(p.ts)))?.phq4Totals.push(p.total);
  for (const m of chats) {
    const text = m.transcript ?? m.content;
    if (text) byDay.get(localDateKey(new Date(m.ts)))?.messages.push(text);
  }
  for (const u of unlockRows) {
    const a = acc(localDateKey(new Date(u.ts)));
    a.unlocks = (a.unlocks ?? 0) + 1;
  }

  for (const row of sensing) {
    const p = parsePayload(row.payload);
    if (!p) continue;
    const day = localDateKey(new Date(row.ts));
    switch (row.stream) {
      case 'steps':
        acc(day).steps = maxOf(acc(day).steps, num(p.count));
        break;
      case 'steps_foreground':
        acc(day).appSteps = maxOf(acc(day).appSteps, num(p.count));
        break;
      case 'health_steps_daily':
        acc(day).healthSteps = maxOf(acc(day).healthSteps, num(p.steps));
        break;
      // One row per hour, each carrying that hour's own count. Keyed by the hour rather than
      // summed on sight, because a re-reported hour would otherwise be counted twice.
      case 'steps_hourly': {
        const hour = num(p.hourStart);
        const steps = num(p.steps);
        if (hour == null || steps == null) break;
        const a = acc(localDateKey(new Date(hour)));
        a.hourlySteps.set(hour, Math.max(a.hourlySteps.get(hour) ?? 0, steps));
        break;
      }
      // Same shape, and only the under-your-own-power minutes: automotive, stationary, unknown and
      // low-confidence time all describe a day without describing movement.
      case 'activity_os': {
        const hour = num(p.hourStart);
        if (hour == null) break;
        const moving =
          (num(p.walkingMin) ?? 0) + (num(p.runningMin) ?? 0) + (num(p.cyclingMin) ?? 0);
        const a = acc(localDateKey(new Date(hour)));
        a.hourlyActive.set(hour, Math.max(a.hourlyActive.get(hour) ?? 0, moving));
        break;
      }
      // A night is filed under the date it ended on, which is the day it shaped. The payload's `date`
      // is the night's *start* (sleepNights.ts keys nights by the evening they began), so the wake
      // time decides; a row without one falls back to the day after its start date.
      case 'sleep_night':
      case 'sleep_night_estimated': {
        const wake = num(p.wakeTs);
        const date =
          wake != null ? localDateKey(new Date(wake)) : typeof p.date === 'string' ? nextDayKey(p.date) : day;
        const ms = num(p.totalAsleepMs);
        if (ms == null) break;
        // Two nights can end on the same day (an evening stretch away from the phone keyed to that
        // day, plus the real night that ended that morning); the longest is the one that shaped it.
        if (row.stream === 'sleep_night') acc(date).sleepMs = maxOf(acc(date).sleepMs, ms);
        else acc(date).sleepEstimateMs = maxOf(acc(date).sleepEstimateMs, ms);
        break;
      }
      // A running day total: keep the latest reading, never a sum.
      case 'app_usage': {
        const ms = num(p.totalForegroundTimeMs);
        const a = acc(day);
        if (ms != null && (a.screen == null || row.ts > a.screen.ts)) a.screen = { ts: row.ts, ms };
        break;
      }
      // Only the whole-phone bucket. The social and audio/video ladders describe parts of the day,
      // and the per-app rows ride this same stream under category 'app'.
      case 'app_usage_threshold': {
        if (p.category !== 'total') break;
        const minutes = num(p.thresholdMinutes);
        if (minutes == null) break;
        acc(day).totalThresholdMin = maxOf(acc(day).totalThresholdMin, minutes);
        break;
      }
      case 'health_heart_rate': {
        const bpm = num(p.bpm);
        if (bpm != null) acc(day).hrAll.push(bpm);
        break;
      }
      case 'health_resting_hr': {
        const bpm = num(p.bpm);
        if (bpm != null) acc(day).hr.push(bpm);
        break;
      }
    }
  }

  return dates.map((date) => ({ ...byDay.get(date)!, physical: toPhysical(accum.get(date)) }));
}
